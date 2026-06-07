import asyncio
import logging
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.models import Document, DocumentSnapshot
from app.services.chunking import split_markdown_into_chunks
from app.services.embeddings import EmbeddingClient
from app.services.parser import parse_document_file, warm_docling_converter
from app.services.vector_store import WorkspaceVectorStore

logger = logging.getLogger(__name__)


class IngestionService:
    def __init__(
        self,
        settings: Settings,
        session_factory: sessionmaker[Session],
        embeddings: EmbeddingClient,
        vector_store: WorkspaceVectorStore,
    ):
        self.settings = settings
        self.session_factory = session_factory
        self.embeddings = embeddings
        self.vector_store = vector_store
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.executor = ProcessPoolExecutor(max_workers=settings.ingestion_workers)
        self.worker_task: asyncio.Task | None = None
        self.warmup_future = None
        self._stopping = False

    async def start(self) -> None:
        if self.settings.warm_docling_on_startup and self.warmup_future is None:
            self.warmup_future = self.executor.submit(warm_docling_converter)
        if self.worker_task is None:
            self.worker_task = asyncio.create_task(self._worker())

    async def stop(self) -> None:
        self._stopping = True
        if self.worker_task:
            self.worker_task.cancel()
            try:
                await self.worker_task
            except asyncio.CancelledError:
                pass
        self.executor.shutdown(wait=False, cancel_futures=True)

    async def enqueue(self, document_id: str) -> None:
        await self.queue.put(document_id)

    async def _worker(self) -> None:
        while not self._stopping:
            document_id = await self.queue.get()
            try:
                await self._process_document(document_id)
            finally:
                self.queue.task_done()

    async def _process_document(self, document_id: str) -> None:
        with self.session_factory() as db:
            document = db.get(Document, document_id)
            if not document:
                return
            document.status = "parsing"
            db.commit()
            file_path = Path(document.filepath)

        try:
            loop = asyncio.get_running_loop()
            parsed = await loop.run_in_executor(
                self.executor,
                parse_document_file,
                str(file_path),
            )
            chunks = split_markdown_into_chunks(
                parsed.sections,
                self.settings.max_chunk_words,
                self.settings.chunk_overlap_words,
            )
            rows = []
            for chunk in chunks:
                vector = await self.embeddings.embed_text(chunk.text)
                rows.append(
                    {
                        "vector": vector,
                        "id": str(uuid4()),
                        "document_id": document_id,
                        "text": chunk.text,
                        "page_label": int(chunk.page_label),
                        "chunk_type": chunk.chunk_type,
                        "filename": file_path.name,
                    }
                )
            self.vector_store.add_chunks(document.workspace_id, rows)

            with self.session_factory() as db:
                document = db.get(Document, document_id)
                if not document:
                    return
                document.status = "indexed"
                document.page_count = parsed.page_count
                db.add(
                    DocumentSnapshot(
                        document_id=document_id,
                        version=1,
                        content_markdown=parsed.markdown,
                    )
                )
                db.commit()
        except Exception:
            logger.exception("Document ingestion failed for document_id=%s", document_id)
            with self.session_factory() as db:
                document = db.get(Document, document_id)
                if document:
                    document.status = "error"
                    db.commit()
