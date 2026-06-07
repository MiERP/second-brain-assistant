from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "0.0.0.0"
    port: int = 8088
    cors_origins: list[str] = Field(default_factory=lambda: ["*"])

    storage_dir: Path = Path("storage")
    db_path: Path = Path("storage/metadata.db")
    lance_db_dir: Path = Path("storage/lancedb")
    documents_dir: Path = Path("storage/documents")

    local_user_id: str = "local-user"
    local_user_email: str = "local@second-brain.local"
    auth_required: bool = False
    jwt_secret: str = "change-me-local-dev-secret"
    jwt_expire_minutes: int = 1440

    llama_host: str = "127.0.0.1"
    llama_auto_root: Path | None = None
    llama_server_bin: Path | None = None
    llama_backend: str | None = None
    llama_profile: str | None = None
    llama_threads: int | None = None
    llama_chat_port: int = 8000
    llama_embed_port: int = 8001
    chat_model_name: str = "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
    embed_model_name: str = "bge-m3-q4_k_m.gguf"
    auto_start_llama: bool = True
    warm_docling_on_startup: bool = False

    chat_context_tokens: int = 8192
    llama_chat_batch_size: int | None = None
    llama_embed_batch_size: int | None = None
    llama_chat_ubatch_size: int | None = None
    llama_embed_ubatch_size: int | None = None
    summarize_history_after_tokens: int = 8000
    retrieval_raw_limit: int = 100
    retrieval_context_limit: int = 15
    embedding_dimension: int = 1024
    fallback_embeddings: bool = True

    ingestion_workers: int = 1
    max_chunk_words: int = 500
    chunk_overlap_words: int = 100

    @property
    def sqlite_url(self) -> str:
        return f"sqlite:///{self.db_path.as_posix()}"

    @property
    def llama_chat_base_url(self) -> str:
        return f"http://{self.llama_host}:{self.llama_chat_port}/v1"

    @property
    def llama_embed_base_url(self) -> str:
        return f"http://{self.llama_host}:{self.llama_embed_port}/v1"

    def ensure_storage_dirs(self) -> None:
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.lance_db_dir.mkdir(parents=True, exist_ok=True)
        self.documents_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_storage_dirs()
    return settings
