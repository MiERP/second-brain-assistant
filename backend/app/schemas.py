from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None


class WorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None
    owner_id: str
    created_at: datetime


class AuthRegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=256)


class AuthLoginRequest(BaseModel):
    email: str
    password: str


class AuthTokenRead(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict[str, str]


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workspace_id: str
    filename: str
    file_size: int
    status: str
    page_count: int | None
    created_at: datetime


class ReportSnapshotRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    report_id: str
    version: int
    content_markdown: str
    content_html: str | None
    created_at: datetime


class ReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workspace_id: str
    title: str
    created_at: datetime
    updated_at: datetime
    latest_snapshot: ReportSnapshotRead


class ReportCreate(BaseModel):
    title: str = Field(default="Untitled report", min_length=1, max_length=160)
    content_markdown: str = ""
    content_html: str | None = None


class ReportUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    content_markdown: str = ""
    content_html: str | None = None


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    conversation_id: str | None = None


class HealthRead(BaseModel):
    status: str
    api: str
    llama_chat_url: str
    llama_embed_url: str
