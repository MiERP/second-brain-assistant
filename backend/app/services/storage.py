import re
import shutil
from pathlib import Path

from fastapi import UploadFile

from app.config import Settings

SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def sanitize_filename(filename: str | None) -> str:
    name = Path(filename or "document").name
    safe = SAFE_FILENAME_RE.sub("_", name).strip("._")
    return safe or "document"


def ensure_safe_workspace_id(workspace_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", workspace_id):
        raise ValueError("Invalid workspace id")
    return workspace_id


def save_upload(settings: Settings, workspace_id: str, document_id: str, file: UploadFile) -> Path:
    safe_workspace_id = ensure_safe_workspace_id(workspace_id)
    original_name = sanitize_filename(file.filename)
    suffix = Path(original_name).suffix.lower()
    target_dir = settings.documents_dir / safe_workspace_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"{document_id}{suffix}"

    with target_path.open("wb") as handle:
        shutil.copyfileobj(file.file, handle)

    return target_path
