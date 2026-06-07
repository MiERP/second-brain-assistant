from datetime import datetime
from pathlib import Path
import shutil

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.database import get_db
from app.models import (
    ChatConversation,
    ChatMessage,
    Document,
    DocumentSnapshot,
    Report,
    ReportSnapshot,
    Workspace,
)
from app.schemas import (
    ChatRequest,
    DocumentRead,
    ReportCreate,
    ReportRead,
    ReportUpdate,
    WorkspaceCreate,
    WorkspaceRead,
)
from app.services.security import get_current_user
from app.services.storage import sanitize_filename, save_upload

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".docx", ".md"}


def require_owned_workspace(db: Session, workspace_id: str, owner_id: str) -> Workspace:
    workspace = db.get(Workspace, workspace_id)
    if not workspace or workspace.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace


def latest_report_snapshot(db: Session, report_id: str) -> ReportSnapshot:
    snapshot = db.scalar(
        select(ReportSnapshot)
        .where(ReportSnapshot.report_id == report_id)
        .order_by(ReportSnapshot.version.desc())
    )
    if not snapshot:
        raise HTTPException(status_code=500, detail="Report snapshot missing")
    return snapshot


def report_response(db: Session, report: Report) -> dict:
    return {
        "id": report.id,
        "workspace_id": report.workspace_id,
        "title": report.title,
        "created_at": report.created_at,
        "updated_at": report.updated_at,
        "latest_snapshot": latest_report_snapshot(db, report.id),
    }


@router.get("", response_model=list[WorkspaceRead])
def list_workspaces(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return list(
        db.scalars(
            select(Workspace)
            .where(Workspace.owner_id == current_user.id)
            .order_by(Workspace.created_at.desc())
        )
    )


@router.post("", response_model=WorkspaceRead, status_code=201)
def create_workspace(
    payload: WorkspaceCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    workspace = Workspace(
        name=payload.name,
        description=payload.description,
        owner_id=current_user.id,
    )
    db.add(workspace)
    db.commit()
    db.refresh(workspace)
    return workspace


@router.delete("/{workspace_id}", status_code=204)
def delete_workspace(
    request: Request,
    workspace_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    current_user=Depends(get_current_user),
):
    workspace = require_owned_workspace(db, workspace_id, current_user.id)

    vector_store = getattr(request.app.state, "vector_store", None)
    if vector_store:
        vector_store.delete_workspace(workspace_id)

    documents = list(
        db.scalars(select(Document).where(Document.workspace_id == workspace_id))
    )
    for document in documents:
        for snapshot in db.scalars(
            select(DocumentSnapshot).where(DocumentSnapshot.document_id == document.id)
        ):
            db.delete(snapshot)
        db.delete(document)

    reports = list(db.scalars(select(Report).where(Report.workspace_id == workspace_id)))
    for report in reports:
        for snapshot in db.scalars(
            select(ReportSnapshot).where(ReportSnapshot.report_id == report.id)
        ):
            db.delete(snapshot)
        db.delete(report)

    conversations = list(
        db.scalars(select(ChatConversation).where(ChatConversation.workspace_id == workspace_id))
    )
    for conversation in conversations:
        for message in db.scalars(
            select(ChatMessage).where(ChatMessage.conversation_id == conversation.id)
        ):
            db.delete(message)
        db.delete(conversation)

    db.delete(workspace)
    db.commit()

    workspace_documents_dir = settings.documents_dir / workspace_id
    if workspace_documents_dir.exists():
        shutil.rmtree(workspace_documents_dir)
    return None


@router.get("/{workspace_id}/documents", response_model=list[DocumentRead])
def list_documents(
    workspace_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    require_owned_workspace(db, workspace_id, current_user.id)
    return list(
        db.scalars(
            select(Document)
            .where(Document.workspace_id == workspace_id)
            .order_by(Document.created_at.desc())
        )
    )


@router.post("/{workspace_id}/upload", response_model=DocumentRead, status_code=202)
async def upload_document(
    request: Request,
    workspace_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    current_user=Depends(get_current_user),
):
    require_owned_workspace(db, workspace_id, current_user.id)

    original_name = sanitize_filename(file.filename)
    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    document = Document(
        workspace_id=workspace_id,
        filename=original_name,
        filepath="",
        file_size=0,
        status="pending",
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    path = save_upload(settings, workspace_id, document.id, file)
    document.filepath = str(path)
    document.file_size = path.stat().st_size
    db.commit()
    db.refresh(document)

    ingestion = getattr(request.app.state, "ingestion", None)
    if ingestion:
        await ingestion.enqueue(document.id)
    return document


@router.get("/{workspace_id}/reports", response_model=list[ReportRead])
def list_reports(
    workspace_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    require_owned_workspace(db, workspace_id, current_user.id)
    reports = list(
        db.scalars(
            select(Report)
            .where(Report.workspace_id == workspace_id)
            .order_by(Report.updated_at.desc())
        )
    )
    return [report_response(db, report) for report in reports]


@router.post("/{workspace_id}/reports", response_model=ReportRead, status_code=201)
def create_report(
    workspace_id: str,
    payload: ReportCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    require_owned_workspace(db, workspace_id, current_user.id)
    now = datetime.utcnow()
    report = Report(
        workspace_id=workspace_id,
        title=payload.title,
        created_at=now,
        updated_at=now,
    )
    db.add(report)
    db.flush()
    db.add(
        ReportSnapshot(
            report_id=report.id,
            version=1,
            content_markdown=payload.content_markdown,
            content_html=payload.content_html,
            created_at=now,
        )
    )
    db.commit()
    db.refresh(report)
    return report_response(db, report)


@router.get("/{workspace_id}/reports/{report_id}", response_model=ReportRead)
def get_report(
    workspace_id: str,
    report_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    require_owned_workspace(db, workspace_id, current_user.id)
    report = db.get(Report, report_id)
    if not report or report.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Report not found")
    return report_response(db, report)


@router.put("/{workspace_id}/reports/{report_id}", response_model=ReportRead)
def update_report(
    workspace_id: str,
    report_id: str,
    payload: ReportUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    require_owned_workspace(db, workspace_id, current_user.id)
    report = db.get(Report, report_id)
    if not report or report.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Report not found")

    latest_version = db.scalar(
        select(func.max(ReportSnapshot.version)).where(ReportSnapshot.report_id == report_id)
    ) or 0
    now = datetime.utcnow()
    if payload.title is not None:
        report.title = payload.title
    report.updated_at = now
    db.add(
        ReportSnapshot(
            report_id=report.id,
            version=latest_version + 1,
            content_markdown=payload.content_markdown,
            content_html=payload.content_html,
            created_at=now,
        )
    )
    db.commit()
    db.refresh(report)
    return report_response(db, report)


@router.post("/{workspace_id}/chat")
async def chat(
    request: Request,
    workspace_id: str,
    payload: ChatRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    agent = request.app.state.agent

    async def event_stream():
        async for event in agent.stream_chat(
            db,
            workspace_id,
            payload.message,
            payload.conversation_id,
            current_user.id,
        ):
            yield event

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/{workspace_id}/documents/{document_id}/file")
def get_document_file(
    workspace_id: str,
    document_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    require_owned_workspace(db, workspace_id, current_user.id)

    document = db.get(Document, document_id)
    if not document or document.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = Path(document.filepath)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    media_type = "application/pdf" if file_path.suffix.lower() == ".pdf" else None
    return FileResponse(path=file_path, filename=document.filename, media_type=media_type)


@router.delete("/{workspace_id}/documents/{document_id}", status_code=204)
def delete_document(
    request: Request,
    workspace_id: str,
    document_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    require_owned_workspace(db, workspace_id, current_user.id)

    document = db.get(Document, document_id)
    if not document or document.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Document not found")

    vector_store = getattr(request.app.state, "vector_store", None)
    if vector_store:
        vector_store.delete_document(workspace_id, document_id)

    file_path = Path(document.filepath)
    for snapshot in db.scalars(
        select(DocumentSnapshot).where(DocumentSnapshot.document_id == document_id)
    ):
        db.delete(snapshot)
    db.delete(document)
    db.commit()

    if file_path.exists():
        file_path.unlink()
    return None
