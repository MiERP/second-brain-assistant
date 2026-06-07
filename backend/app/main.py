from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import SessionLocal, init_db
from app.routers import auth, health, workspaces
from app.services.agent import ResearchAgent
from app.services.embeddings import EmbeddingClient
from app.services.ingestion import IngestionService
from app.services.llama_process import LlamaProcessManager
from app.services.llm_client import LlamaChatClient
from app.services.vector_store import WorkspaceVectorStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.ensure_storage_dirs()
    init_db()

    embeddings = EmbeddingClient(settings)
    vector_store = WorkspaceVectorStore(settings)
    llm = LlamaChatClient(settings)
    llama = LlamaProcessManager(settings)
    ingestion = IngestionService(settings, SessionLocal, embeddings, vector_store)

    app.state.settings = settings
    app.state.embeddings = embeddings
    app.state.vector_store = vector_store
    app.state.llama = llama
    app.state.ingestion = ingestion
    app.state.agent = ResearchAgent(settings, embeddings, vector_store, llm)

    await ingestion.start()
    if settings.auto_start_llama:
        await llama.ensure_started()
    try:
        yield
    finally:
        await ingestion.stop()
        await llama.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Second Brain Assistant API",
        description="Local-first research and report-writing backend",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(workspaces.router)
    return app


app = create_app()
