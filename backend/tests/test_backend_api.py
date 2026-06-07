import sys
import asyncio
from datetime import datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def make_client(monkeypatch, tmp_path, extra_env=None):
    monkeypatch.setenv("STORAGE_DIR", str(tmp_path / "storage"))
    monkeypatch.setenv("DB_PATH", str(tmp_path / "storage" / "metadata.db"))
    monkeypatch.setenv("LANCE_DB_DIR", str(tmp_path / "storage" / "lancedb"))
    monkeypatch.setenv("DOCUMENTS_DIR", str(tmp_path / "storage" / "documents"))
    monkeypatch.setenv("AUTO_START_LLAMA", "false")
    monkeypatch.setenv("FALLBACK_EMBEDDINGS", "true")
    monkeypatch.setenv("WARM_DOCLING_ON_STARTUP", "false")
    if extra_env:
        for key, value in extra_env.items():
            monkeypatch.setenv(key, value)

    from app.config import get_settings

    get_settings.cache_clear()

    import app.database as database

    settings = get_settings()
    database.settings = settings
    database.engine.dispose()
    database.engine = database.create_engine(
        settings.sqlite_url,
        connect_args={"check_same_thread": False},
        future=True,
    )
    database.SessionLocal.configure(bind=database.engine)

    from app.main import create_app

    return TestClient(create_app())


def test_sanitize_filename_removes_path_traversal():
    from app.services.storage import sanitize_filename

    assert sanitize_filename("../../secret report!!.pdf") == "secret_report_.pdf"
    assert sanitize_filename("..") == "document"


def test_workspace_upload_and_chat_sse(monkeypatch, tmp_path):
    with make_client(monkeypatch, tmp_path) as client:
        created = client.post(
            "/workspaces",
            json={"name": "Research", "description": "Local docs"},
        )
        assert created.status_code == 201
        workspace_id = created.json()["id"]

        upload = client.post(
            f"/workspaces/{workspace_id}/upload",
            files={"file": ("../../battery-notes.md", b"# Battery\nTesla range: 16\n", "text/markdown")},
        )
        assert upload.status_code == 202
        payload = upload.json()
        assert payload["filename"] == "battery-notes.md"
        assert payload["status"] in {"pending", "parsing", "indexed"}
        assert "filepath" not in payload

        response = client.post(
            f"/workspaces/{workspace_id}/chat",
            json={"message": "Summarize Tesla battery range"},
        )
        assert response.status_code == 200
        body = response.text
        assert "event: status" in body
        assert "event: citations" in body
        assert "event: text" in body
        assert "event: done" in body


def test_auth_required_filters_workspaces_by_owner(monkeypatch, tmp_path):
    with make_client(
        monkeypatch,
        tmp_path,
        {"AUTH_REQUIRED": "true", "JWT_SECRET": "test-secret"},
    ) as client:
        token_a = client.post(
            "/auth/register",
            json={"email": "a@example.com", "password": "password-a"},
        ).json()["access_token"]
        token_b = client.post(
            "/auth/register",
            json={"email": "b@example.com", "password": "password-b"},
        ).json()["access_token"]

        created = client.post(
            "/workspaces",
            json={"name": "Private A"},
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert created.status_code == 201

        list_a = client.get("/workspaces", headers={"Authorization": f"Bearer {token_a}"})
        list_b = client.get("/workspaces", headers={"Authorization": f"Bearer {token_b}"})
        assert [workspace["name"] for workspace in list_a.json()] == ["Private A"]
        assert list_b.json() == []


def test_delete_document_removes_metadata_and_file(monkeypatch, tmp_path):
    with make_client(monkeypatch, tmp_path) as client:
        created = client.post("/workspaces", json={"name": "Cleanup"})
        workspace_id = created.json()["id"]
        upload = client.post(
            f"/workspaces/{workspace_id}/upload",
            files={"file": ("notes.md", b"# Notes\n", "text/markdown")},
        )
        assert upload.status_code == 202
        document = upload.json()
        from app.database import SessionLocal
        from app.models import Document

        with SessionLocal() as db:
            stored_document = db.get(Document, document["id"])
            assert stored_document is not None
            file_path = Path(stored_document.filepath)
        assert file_path.exists()

        deleted = client.delete(f"/workspaces/{workspace_id}/documents/{document['id']}")

        assert deleted.status_code == 204
        assert not file_path.exists()
        listed = client.get(f"/workspaces/{workspace_id}/documents")
        assert listed.json() == []


def test_delete_workspace_removes_documents_reports_and_vectors(monkeypatch, tmp_path):
    with make_client(monkeypatch, tmp_path) as client:
        created = client.post("/workspaces", json={"name": "Delete me"})
        workspace_id = created.json()["id"]
        upload = client.post(
            f"/workspaces/{workspace_id}/upload",
            files={"file": ("notes.md", b"# Notes\n", "text/markdown")},
        )
        document_id = upload.json()["id"]

        from app.config import get_settings
        from app.database import SessionLocal
        from app.models import Document
        from app.services.vector_store import WorkspaceVectorStore

        settings = get_settings()
        store = WorkspaceVectorStore(settings)
        table_name = store.table_name(workspace_id)
        store._append_jsonl(
            table_name,
            [{"id": "chunk-1", "document_id": document_id, "vector": [1.0], "text": "Notes"}],
        )
        vector_path = store._fallback_path(table_name)
        assert vector_path.exists()

        report = client.post(
            f"/workspaces/{workspace_id}/reports",
            json={"title": "Draft", "content_markdown": "draft"},
        )
        assert report.status_code == 201

        with SessionLocal() as db:
            stored_document = db.get(Document, document_id)
            assert stored_document is not None
            file_path = Path(stored_document.filepath)
            workspace_dir = file_path.parent
        assert file_path.exists()

        deleted = client.delete(f"/workspaces/{workspace_id}")

        assert deleted.status_code == 204
        assert client.get("/workspaces").json() == []
        assert not workspace_dir.exists()
        assert not vector_path.exists()


def test_report_api_saves_loads_and_versions_workspace_drafts(monkeypatch, tmp_path):
    with make_client(monkeypatch, tmp_path) as client:
        created = client.post("/workspaces", json={"name": "Reports"})
        workspace_id = created.json()["id"]

        saved = client.post(
            f"/workspaces/{workspace_id}/reports",
            json={
                "title": "Battery comparison",
                "content_markdown": "# Draft\nTesla vs BYD",
                "content_html": "<h1>Draft</h1><p>Tesla vs BYD</p>",
            },
        )

        assert saved.status_code == 201
        report = saved.json()
        assert report["title"] == "Battery comparison"
        assert report["latest_snapshot"]["version"] == 1
        assert report["latest_snapshot"]["content_markdown"] == "# Draft\nTesla vs BYD"
        assert report["latest_snapshot"]["content_html"] == "<h1>Draft</h1><p>Tesla vs BYD</p>"

        updated = client.put(
            f"/workspaces/{workspace_id}/reports/{report['id']}",
            json={
                "title": "Battery comparison v2",
                "content_markdown": "# Draft\nUpdated",
                "content_html": "<h1>Draft</h1><p>Updated</p>",
            },
        )

        assert updated.status_code == 200
        updated_report = updated.json()
        assert updated_report["title"] == "Battery comparison v2"
        assert updated_report["latest_snapshot"]["version"] == 2

        loaded = client.get(f"/workspaces/{workspace_id}/reports/{report['id']}")

        assert loaded.status_code == 200
        assert loaded.json()["latest_snapshot"]["content_markdown"] == "# Draft\nUpdated"


def test_report_api_enforces_workspace_owner(monkeypatch, tmp_path):
    with make_client(
        monkeypatch,
        tmp_path,
        {"AUTH_REQUIRED": "true", "JWT_SECRET": "test-secret"},
    ) as client:
        token_a = client.post(
            "/auth/register",
            json={"email": "report-a@example.com", "password": "password-a"},
        ).json()["access_token"]
        token_b = client.post(
            "/auth/register",
            json={"email": "report-b@example.com", "password": "password-b"},
        ).json()["access_token"]
        workspace = client.post(
            "/workspaces",
            json={"name": "Private reports"},
            headers={"Authorization": f"Bearer {token_a}"},
        ).json()
        report = client.post(
            f"/workspaces/{workspace['id']}/reports",
            json={"title": "Private", "content_markdown": "secret"},
            headers={"Authorization": f"Bearer {token_a}"},
        ).json()

        blocked = client.get(
            f"/workspaces/{workspace['id']}/reports/{report['id']}",
            headers={"Authorization": f"Bearer {token_b}"},
        )

        assert blocked.status_code == 404


def test_docling_parser_preserves_page_metadata(monkeypatch, tmp_path):
    from app.services import parser

    class FakeProv:
        def __init__(self, page_no):
            self.page_no = page_no

    class FakeItem:
        def __init__(self, text, page_no):
            self.text = text
            self.prov = [FakeProv(page_no)]

    class FakeDocument:
        pages = {"1": {}, "2": {}}

        def export_to_markdown(self):
            return "page one\n\npage two"

        def iterate_items(self):
            return [(FakeItem("page one", 1), 0), (FakeItem("page two", 2), 0)]

    class FakeResult:
        document = FakeDocument()

    class FakeConverter:
        def convert(self, path):
            return FakeResult()

    monkeypatch.setattr(parser, "get_docling_converter", lambda: FakeConverter())
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")

    parsed = parser.parse_document_file(str(pdf_path))

    assert parsed.page_count == 2
    assert [(section.text, section.page_label) for section in parsed.sections] == [
        ("page one", 1),
        ("page two", 2),
    ]


def test_pdf_parser_falls_back_to_pypdf_when_docling_is_missing(monkeypatch, tmp_path):
    from app.services import parser

    class FakePage:
        def extract_text(self):
            return "Fallback PDF text"

    class FakeReader:
        def __init__(self, path):
            self.pages = [FakePage()]

    monkeypatch.setattr(parser, "get_docling_converter", lambda: (_ for _ in ()).throw(ModuleNotFoundError("docling")))
    monkeypatch.setattr("pypdf.PdfReader", FakeReader)
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")

    parsed = parser.parse_document_file(str(pdf_path))

    assert parsed.page_count == 1
    assert parsed.sections[0].text == "Fallback PDF text"


def test_agent_uses_llm_planner_and_streams_text_before_completion(monkeypatch, tmp_path):
    with make_client(monkeypatch, tmp_path) as client:
        created = client.post("/workspaces", json={"name": "Agentic"})
        workspace_id = created.json()["id"]

        from app.config import get_settings
        from app.database import SessionLocal
        from app.services.agent import ResearchAgent

        class FakeEmbeddings:
            async def embed_text(self, text):
                return [1.0, 0.0] if "Tesla" in text else [0.0, 1.0]

        class FakeVectorStore:
            def __init__(self):
                self.queries = []

            def search(self, workspace_id, vector, limit):
                self.queries.append(vector)
                return [
                    {
                        "vector": vector,
                        "id": f"chunk-{len(self.queries)}",
                        "document_id": "doc-1",
                        "text": "Tesla battery energy density: 250",
                        "page_label": 3,
                        "chunk_type": "text",
                        "filename": "battery.pdf",
                    }
                ]

        class FakeLLM:
            def __init__(self):
                self.planner_called = False
                self.completed = False

            async def plan_sub_queries(self, message, history=None):
                self.planner_called = True
                return ["Tesla energy density", "BYD battery cost"]

            async def stream_completion(self, prompt):
                yield "first "
                await asyncio.sleep(0)
                self.completed = True
                yield "second"

        vector_store = FakeVectorStore()
        llm = FakeLLM()
        agent = ResearchAgent(get_settings(), FakeEmbeddings(), vector_store, llm)

        async def collect_until_first_text():
            with SessionLocal() as db:
                async for event in agent.stream_chat(
                    db,
                    workspace_id,
                    "Compare Tesla and BYD batteries",
                    None,
                    "local-user",
                ):
                    if event.startswith("event: text"):
                        return event, llm.completed
            raise AssertionError("No text event streamed")

        first_text, completed_at_first_text = asyncio.run(collect_until_first_text())

        assert llm.planner_called is True
        assert vector_store.queries == [[1.0, 0.0], [0.0, 1.0]]
        assert '"delta": "first "' in first_text
        assert completed_at_first_text is False


def test_agent_status_events_are_emitted_from_running_nodes(monkeypatch, tmp_path):
    with make_client(monkeypatch, tmp_path) as client:
        created = client.post("/workspaces", json={"name": "Statuses"})
        workspace_id = created.json()["id"]

        from app.config import get_settings
        from app.database import SessionLocal
        from app.services.agent import ResearchAgent

        planner_release = asyncio.Event()

        class FakeEmbeddings:
            async def embed_text(self, text):
                return [1.0]

        class FakeVectorStore:
            def search(self, workspace_id, vector, limit):
                return []

        class FakeLLM:
            async def plan_sub_queries(self, message, history=None):
                await planner_release.wait()
                return ["status test"]

            async def stream_completion(self, prompt):
                yield "done"

        agent = ResearchAgent(get_settings(), FakeEmbeddings(), FakeVectorStore(), FakeLLM())

        async def collect_first_two_events():
            with SessionLocal() as db:
                stream = agent.stream_chat(
                    db,
                    workspace_id,
                    "Test status timing",
                    None,
                    "local-user",
                )
                first = await anext(stream)
                second_task = asyncio.create_task(anext(stream))
                await asyncio.sleep(0.05)
                second_arrived_before_planner_finishes = second_task.done()
                planner_release.set()
                second = await second_task
                remaining = []
                async for event in stream:
                    remaining.append(event)
                return first, second_arrived_before_planner_finishes, second, remaining

        first, second_arrived_before_planner_finishes, second, remaining = asyncio.run(
            collect_first_two_events()
        )

        assert '"node": "planner"' in first
        assert second_arrived_before_planner_finishes is False
        assert '"node": "retriever"' in second
        assert any('"node": "synthesizer"' in event for event in remaining)


def test_agent_planner_receives_conversation_history(monkeypatch, tmp_path):
    with make_client(monkeypatch, tmp_path) as client:
        created = client.post("/workspaces", json={"name": "Follow-up"})
        workspace_id = created.json()["id"]

        from app.config import get_settings
        from app.database import SessionLocal
        from app.models import ChatConversation, ChatMessage
        from app.services.agent import ResearchAgent

        class FakeEmbeddings:
            async def embed_text(self, text):
                return [1.0, 0.0]

        class FakeVectorStore:
            def search(self, workspace_id, vector, limit):
                return []

        class FakeLLM:
            def __init__(self):
                self.history = None

            async def plan_sub_queries(self, message, history=None):
                self.history = history
                return ["battery density follow-up"]

            async def stream_completion(self, prompt):
                yield "answer"

        with SessionLocal() as db:
            conversation = ChatConversation(workspace_id=workspace_id, title="Old topic")
            db.add(conversation)
            db.commit()
            db.refresh(conversation)
            db.add_all(
                [
                    ChatMessage(
                        conversation_id=conversation.id,
                        role="user",
                        content="Compare Tesla battery density",
                        created_at=datetime.utcnow() - timedelta(minutes=1),
                    ),
                    ChatMessage(
                        conversation_id=conversation.id,
                        role="assistant",
                        content="Tesla has higher reported density.",
                        created_at=datetime.utcnow(),
                    ),
                ]
            )
            db.commit()
            conversation_id = conversation.id

        llm = FakeLLM()
        agent = ResearchAgent(get_settings(), FakeEmbeddings(), FakeVectorStore(), llm)

        async def collect():
            with SessionLocal() as db:
                async for _ in agent.stream_chat(
                    db,
                    workspace_id,
                    "Chi tiet hon ve dieu do?",
                    conversation_id,
                    "local-user",
                ):
                    pass

        asyncio.run(collect())

        assert llm.history is not None
        assert [item["content"] for item in llm.history] == [
            "Compare Tesla battery density",
            "Tesla has higher reported density.",
        ]


def test_agent_handles_array_like_vectors_from_lancedb(monkeypatch, tmp_path):
    with make_client(monkeypatch, tmp_path):
        from app.config import get_settings
        from app.services.agent import ResearchAgent

        class ArrowLikeVector:
            def __init__(self, values):
                self.values = values

            def to_pylist(self):
                return self.values

        agent = ResearchAgent(get_settings(), object(), object(), object())

        assert agent._cosine([1.0, 0.0], ArrowLikeVector([1.0, 0.0])) == 1.0


def test_agent_prompt_respects_history_context_budget(monkeypatch, tmp_path):
    with make_client(
        monkeypatch,
        tmp_path,
        {"SUMMARIZE_HISTORY_AFTER_TOKENS": "80"},
    ):
        from app.config import get_settings
        from app.services.agent import ResearchAgent

        agent = ResearchAgent(get_settings(), object(), object(), object())
        history = [
            {"role": "user", "content": f"older message {index} " + ("x" * 500)}
            for index in range(20)
        ]

        prompt = asyncio.run(agent._build_prompt("current question", history, [], []))

        assert len(prompt) < 1200
        assert "older message 0" not in prompt
        assert "older message 19" in prompt


def test_agent_summarizes_old_history_when_token_budget_is_exceeded(monkeypatch, tmp_path):
    with make_client(
        monkeypatch,
        tmp_path,
        {"SUMMARIZE_HISTORY_AFTER_TOKENS": "40"},
    ):
        from app.config import get_settings
        from app.services.agent import ResearchAgent

        class FakeLLM:
            def __init__(self):
                self.summary_input = None

            async def summarize_history(self, history, target_tokens):
                self.summary_input = history
                return "SUMMARY: user compared Tesla and BYD battery density."

        history = [
            {"role": "user", "content": "Older Tesla density discussion " + ("x" * 80)}
            for _ in range(8)
        ] + [{"role": "assistant", "content": "Recent answer about BYD"}]
        llm = FakeLLM()
        agent = ResearchAgent(get_settings(), object(), object(), llm)

        prompt = asyncio.run(agent._build_prompt("Give more details", history, [], []))

        assert llm.summary_input is not None
        assert "SUMMARY: user compared Tesla and BYD battery density." in prompt
        assert "Recent answer about BYD" in prompt


def test_discrepancy_metric_labels_use_word_boundaries(monkeypatch, tmp_path):
    with make_client(monkeypatch, tmp_path):
        from app.config import get_settings
        from app.services.agent import ResearchAgent

        agent = ResearchAgent(get_settings(), object(), object(), object())

        assert agent._needs_user_clarification(
            [{"text": "customer count: 10"}, {"text": "customer count: 12"}]
        ) is False
        assert agent._needs_user_clarification(
            [{"text": "cost: 10"}, {"text": "cost: 12"}]
        ) is True


def test_discrepancy_checker_ignores_page_numbers(monkeypatch, tmp_path):
    with make_client(monkeypatch, tmp_path):
        from app.config import get_settings
        from app.services.agent import ResearchAgent

        agent = ResearchAgent(get_settings(), object(), object(), object())

        assert agent._needs_user_clarification(
            [{"text": "page: 5"}, {"text": "page: 12"}]
        ) is False
        assert agent._needs_user_clarification(
            [{"text": "revenue: 10"}, {"text": "revenue: 12"}]
        ) is True


def test_vector_store_jsonl_fallback_uses_cosine_similarity(monkeypatch, tmp_path):
    import builtins

    from app.config import Settings
    from app.services.vector_store import WorkspaceVectorStore

    settings = Settings(
        storage_dir=tmp_path / "storage",
        db_path=tmp_path / "storage" / "metadata.db",
        lance_db_dir=tmp_path / "storage" / "lancedb",
        documents_dir=tmp_path / "storage" / "documents",
    )
    store = WorkspaceVectorStore(settings)
    table_name = store.table_name("research")
    store._append_jsonl(
        table_name,
        [
            {"id": "relevant", "vector": [1.0, 0.0], "text": "target"},
            {"id": "irrelevant", "vector": [-1.0, 0.0], "text": "other"},
        ],
    )

    original_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "lancedb":
            raise ImportError("force fallback")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    results = store.search("research", [1.0, 0.0], 1)

    assert [row["id"] for row in results] == ["relevant"]


def test_llama_process_manager_finds_windows_resource_layout(tmp_path):
    from app.config import Settings
    from app.services.llama_process import LlamaProcessManager

    root = tmp_path / "start-llama-auto"
    (root / "cpu-x64").mkdir(parents=True)
    (root / "models").mkdir()
    server = root / "cpu-x64" / "llama-server.exe"
    chat_model = root / "models" / "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
    embed_model = root / "models" / "bge-m3-q4_k_m.gguf"
    server.write_text("", encoding="utf-8")
    chat_model.write_text("", encoding="utf-8")
    embed_model.write_text("", encoding="utf-8")

    manager = LlamaProcessManager(
        Settings(
            llama_auto_root=root,
            chat_model_name=chat_model.name,
            embed_model_name=embed_model.name,
        )
    )

    assert manager.find_llama_server_bin() == server
    assert manager.find_model("chat") == chat_model
    assert manager.find_model("embedding") == embed_model
    chat_args = manager.build_args("chat", chat_model)
    assert chat_args[chat_args.index("--ctx-size") + 1] == "8192"


def test_llama_process_manager_prefers_project_resource_models(monkeypatch, tmp_path):
    from app.config import Settings
    from app.services.llama_process import LlamaProcessManager

    monkeypatch.chdir(tmp_path)
    model_dir = tmp_path / "resources" / "models"
    model_dir.mkdir(parents=True)
    chat_model = model_dir / "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
    embed_model = model_dir / "bge-m3-q4_k_m.gguf"
    chat_model.write_text("", encoding="utf-8")
    embed_model.write_text("", encoding="utf-8")

    manager = LlamaProcessManager(
        Settings(
            chat_model_name=chat_model.name,
            embed_model_name=embed_model.name,
        )
    )

    assert manager.find_model("chat") == chat_model
    assert manager.find_model("embedding") == embed_model


def test_llama_process_manager_builds_hardware_profile_args(monkeypatch, tmp_path):
    from app.config import Settings
    from app.services.llama_process import LlamaProcessManager, MachineInfo

    model = tmp_path / "chat.gguf"
    model.write_text("", encoding="utf-8")
    manager = LlamaProcessManager(Settings(llama_profile="low", llama_threads=6))
    monkeypatch.setattr(
        manager,
        "detect_machine_info",
        lambda: MachineInfo(4, 12, 8192, "AMD Radeon", "AMD", "Discrete", 8192, True),
    )

    args = manager.build_args("chat", model)

    assert args[args.index("--ctx-size") + 1] == "2048"
    assert args[args.index("--threads") + 1] == "6"
    assert args[args.index("--batch-size") + 1] == "128"
    assert args[args.index("--ubatch-size") + 1] == "64"
    assert args[args.index("--n-gpu-layers") + 1] == "999"
