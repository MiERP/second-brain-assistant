# 📋 Báo Cáo Đánh Giá Codebase: Second Brain Assistant

> **Ngày đánh giá:** 06/06/2026 | **Reviewer:** Antigravity
> **Phạm vi:** Backend (FastAPI), Frontend (Next.js), Docs (3 file)

---

## TL;DR — Nhận Xét Tổng Quan

Codebase đang ở **Giai đoạn 2.5/4** của lộ trình. Kiến trúc cơ bản đã đúng hướng và có một số điểm tốt đáng khen (LangGraph đã được tích hợp thật, LlamaProcessManager hoàn chỉnh, Auth đã có JWT). Tuy nhiên vẫn còn **5 vấn đề nghiêm trọng** chưa được giải quyết hoặc giải quyết chưa đúng theo yêu cầu trong `codex_backend_brief.md`, khiến hệ thống chưa thể chạy production.

---

## 1. BACKEND — Phân Tích Chi Tiết

### ✅ Điểm Tốt

| Hạng mục | Đánh giá |
|---|---|
| **Kiến trúc phân tầng** | Router → Service → Repository rõ ràng, đúng chuẩn |
| **LangGraph đã dùng thật** | `StateGraph` với 5 node (planner, retriever, discrepancy_checker, writer, self_correction) và conditional edge — đúng yêu cầu |
| **`LlamaProcessManager`** | Hoàn chỉnh: detect hardware, tính toán `--threads`, `--n-gpu-layers`, fallback tìm root, auto-restart qua `_watch()` |
| **Auth/Security** | JWT tự implement bằng HMAC-SHA256 (tránh phụ thuộc `python-jose`), `auth_required=False` bypass cho Desktop mode |
| **Workspace isolation** | LanceDB phân bảng theo `workspace_{id}_chunks` — đúng yêu cầu |
| **Singleton `DocumentConverter`** | Dùng `@lru_cache(maxsize=1)` để warm up 1 lần — đúng yêu cầu §6.3 |
| **Docling page_label** | `_item_page_label()` đọc `item.prov[0].page_no` — đúng yêu cầu §6.2 |
| **Path traversal guard** | `sanitize_filename()` trong `storage.py` lọc ký tự nguy hiểm |
| **Ingestion ProcessPool isolation** | Worker crash không kéo FastAPI chính xuống |
| **SSE stream format** | Events `status`, `citations`, `text`, `done`, `error` đúng spec §4 |

---

### 🔴 Vấn Đề Nghiêm Trọng (Blockers)

#### BUG-01: `_plan()` vẫn dùng regex — Chưa gọi LLM

**File:** [`agent.py#L180-182`](file:///d:/PROJECT/Agentic-AI/second-brain-assistant/backend/app/services/agent.py#L180-L182)

```python
# Hiện tại — REGEX rất sơ sài:
def _plan(self, message: str) -> list[str]:
    parts = [part.strip(" ?.") for part in re.split(r"\band\b|,|;|\n", message) if part.strip()]
    return parts[:5] or [message]
```

**Vấn đề:** Đây là node quan trọng nhất của Agentic RAG nhưng hoàn toàn không gọi LLM. Câu hỏi "Hãy so sánh pin Tesla và BYD về mật độ năng lượng và chi phí" sẽ bị split thành `["Hãy so sánh pin Tesla", "BYD về mật độ năng lượng", "chi phí"]` — vô nghĩa.

**Yêu cầu trong brief §6.1:** "sử dụng mô hình suy luận" không phải regex.

---

#### BUG-02: `_rerank()` vẫn dùng keyword matching — Không có LLM re-ranker

**File:** [`agent.py#L184-191`](file:///d:/PROJECT/Agentic-AI/second-brain-assistant/backend/app/services/agent.py#L184-L191)

```python
def _rerank(self, query: str, rows: list[dict]) -> list[dict]:
    query_terms = {term.lower() for term in re.findall(r"\w+", query)}
    def score(row: dict) -> int:
        terms = {term.lower() for term in re.findall(r"\w+", row.get("text", ""))}
        return len(query_terms & terms)
    return sorted(rows, key=score, reverse=True)
```

**Vấn đề:** Term-frequency overlap chỉ đếm từ khớp, không hiểu ngữ nghĩa. Brief §3 yêu cầu **local re-ranker model** để lọc từ 100 → 15 chunks. Kết quả: chunks kém liên quan lọt vào context → hallucination tăng.

---

#### BUG-03: Stream text bị delay — SSE yield bất đồng bộ

**File:** [`agent.py#L62-95`](file:///d:/PROJECT/Agentic-AI/second-brain-assistant/backend/app/services/agent.py#L62-L95)

```python
# Vấn đề: graph.ainvoke() chạy xong TOÀN BỘ graph rồi mới yield
yield sse("status", {...})  # yield ngay
yield sse("status", {...})  # yield ngay
state = await self.graph.ainvoke(...)  # BLOCK cho đến khi writer node xong hết
# SAU ĐÓ mới split_answer_for_stream và yield từng chunk
for delta in self._split_answer_for_stream(answer):
    yield sse("text", {"delta": delta})
```

**Vấn đề:** Frontend nghĩ đang stream real-time, nhưng thực ra backend batch toàn bộ LLM response vào RAM rồi mới "fake stream". Với văn bản dài, user chờ 30-60 giây không thấy gì.

**Giải pháp:** `writer_node` phải `yield` trực tiếp từ `llm.stream_completion()`, nhưng LangGraph `StateGraph` không hỗ trợ streaming native trong node. Cần refactor sang `LangGraph` streaming mode hoặc tách writer ra ngoài graph.

---

#### BUG-04: `_needs_user_clarification()` — False positives rất cao

**File:** [`agent.py#L212-221`](file:///d:/PROJECT/Agentic-AI/second-brain-assistant/backend/app/services/agent.py#L212-L221)

```python
for label, number in re.findall(
    r"([A-Za-z][A-Za-z0-9 _-]{2,40})\s*[:=]\s*(\d+(?:\.\d+)?)",
    text,
):
    numbers_by_key.setdefault(label.strip().lower(), set()).add(number)
return any(len(values) > 1 for values in numbers_by_key.values())
```

**Vấn đề:** Pattern này cực kỳ dễ trigger false positive. Ví dụ: chunk 1 có "page: 5", chunk 2 có "page: 12" → `{"page": {"5", "12"}}` → `needs_clarification=True` → luồng bị ngắt và yêu cầu user chọn dù không có mâu thuẫn thực sự. Regex không phân biệt được "số trang", "năm", "phiên bản" với "số liệu kinh tế".

---

#### BUG-05: `WorkspaceSidebar` gọi API không có Authorization header

**File:** [`workspace-sidebar.tsx#L29`](file:///d:/PROJECT/Agentic-AI/second-brain-assistant/frontend/src/components/workspace-sidebar.tsx#L29)

```typescript
const res = await fetch(`${API_BASE}/workspaces`);
// Không có: headers: { "Authorization": `Bearer ${token}` }
```

**Vấn đề:** Hiện tại `auth_required=false` nên ẩn lỗi này. Nhưng khi bật auth lên (chế độ multi-user/web), tất cả API calls trong sidebar và chat-panel sẽ bị 401. Không có state quản lý token nào ở frontend.

---

### 🟡 Vấn Đề Nhỏ / Cải Thiện

#### WARN-01: `config.py` — Port conflict tiềm năng

```python
llama_chat_port: int = 8000   # llama-server chat
port: int = 8088              # FastAPI app
```

Brief §2.1 ghi: "Chat Server (Port 8000)", nhưng thực tế FastAPI app dùng 8088, llama chat dùng 8000. Cần cập nhật lại doc và `.env.example` cho nhất quán.

#### WARN-02: `ingestion.py` — Exception bị nuốt im

```python
except Exception:   # Bắt tất cả exception nhưng không log
    with self.session_factory() as db:
        document.status = "error"
```

Không có `logging.exception(...)` → khi Docling crash do OOM hoặc file corrupt, dev không có stacktrace để debug.

#### WARN-03: `vector_store.py` — Fallback JSONL không có vector search thật

```python
def _search_jsonl(self, table_name: str, limit: int) -> list[dict]:
    return rows[-limit:]  # Chỉ lấy N dòng cuối, không tính cosine similarity
```

Khi LanceDB fail và fallback sang JSONL, kết quả tìm kiếm hoàn toàn ngẫu nhiên (lấy N dòng cuối). Cần ít nhất implement naive cosine similarity trong fallback.

#### WARN-04: `security.py` — JWT tự implement có rủi ro

```python
def _sign(signing_input: str, secret: str) -> str:
    digest = hmac.new(secret.encode(), ...)
```

Tự implement JWT từ đầu dễ có lỗi subtle (timing attack, padding, etc.). Nên dùng `python-jose` hoặc `PyJWT`. Hiện tại nếu `auth_required=False` thì không ảnh hưởng, nhưng khi bật auth lên cần review kỹ.

#### WARN-05: `requirements.txt` — Version pinning quá lỏng

```
fastapi>=0.110.0
langgraph>=1.2.4
docling>=1.0.0
```

Dùng `>=` không pin version cụ thể → CI/CD build non-deterministic. Nên dùng `pip freeze > requirements.txt` sau khi test ổn định.

---

## 2. FRONTEND — Phân Tích Chi Tiết

### ✅ Điểm Tốt

| Hạng mục | Đánh giá |
|---|---|
| **Split-screen layout** | 3 panel (Sidebar + Chat + Editor/Viewer) đúng design spec |
| **SSE parser** | Buffer-aware, handle split-line, multi-event types — khá tốt |
| **Thought logs UI** | DeepSeek-style collapsible `<details>` với pulse animation — UX tốt |
| **Citation buttons** | Click citation → `onClickCitation()` → PDF Viewer jump to page — đúng spec §2.2 |
| **"Đẩy sang Editor" button** | `onApplyToEditor()` callback — đúng spec §2.2 |
| **PDF rendering** | pdfjs-dist với canvas rendering và highlight overlay — khá complete |
| **Document polling** | Poll 3s khi có doc ở trạng thái `parsing/pending` — UX tốt |

---

### 🔴 Vấn Đề Nghiêm Trọng

#### FE-BUG-01: Custom Markdown renderer quá đơn giản — Bị lỗi regex

**File:** [`chat-panel.tsx#L192`](file:///d:/PROJECT/Agentic-AI/second-brain-assistant/frontend/src/components/chat-panel.tsx#L192)

```typescript
const regex = /(\\[\\d+\\]|\\*\\*.*?\\*\\*|###.*?\\n|-.*?\\n)/g;
```

**Vấn đề:**
1. Pattern `-.*?\n` sẽ match bất kỳ dòng nào bắt đầu bằng `-`, kể cả nội dung không phải list item như "- - -" (divider) hay URL.
2. Chỉ handle `###` heading, bỏ qua `#` và `##`.
3. Không handle `_italic_`, `code blocks`, numbered list `1.`.
4. Không handle newlines đúng cách — `whitespace-pre-line` kết hợp với regex split gây double-spacing.

**Khuyến nghị:** Dùng `react-markdown` + `remark-gfm` thay vì custom parser.

#### FE-BUG-02: `chat-panel.tsx` — Gửi token auth trong request

Tương tự BUG-05 backend, tất cả `fetch()` trong frontend không gắn `Authorization` header. Khi backend bật auth, app ngừng hoạt động toàn bộ.

#### FE-BUG-03: `activeWorkspaceId` default là `"default"` — ID không tồn tại

**File:** [`page.tsx#L8`](file:///d:/PROJECT/Agentic-AI/second-brain-assistant/frontend/src/app/page.tsx#L8)

```typescript
const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("default");
```

Khi load lần đầu, sidebar fetch workspaces xong tự `setActiveWorkspaceId(data[0].id)`, nhưng trong khoảng thời gian trước đó, ChatPanel sẽ gọi API chat với `workspace_id = "default"` → 404. Nên init là `""` và disable input cho đến khi có workspace thật.

---

### 🟡 Vấn Đề Nhỏ / Cải Thiện Frontend

#### FE-WARN-01: `pdf-viewer.tsx` — Hard-coded simulated content

```typescript
if (documentInfo?.filename.includes("tesla")) { ... }
if (documentInfo?.filename.includes("byd")) { ... }
```

Đây là nội dung demo hard-code. Cần xóa và thay bằng fallback generic khi backend không serve được file.

#### FE-WARN-02: Không có Error Boundary / Toast notification

Khi upload fail, API lỗi, chỉ có `console.error()`. User không thấy thông báo lỗi. Cần thêm toast notification (có thể dùng `sonner` hoặc custom).

#### FE-WARN-03: `rich-editor.tsx` — Chưa review

File này 9KB nhưng chưa được đánh giá. Cần kiểm tra Tiptap integration có đúng không.

---

## 3. ĐỐI CHIẾU VỚI DOCS — Compliance Matrix

### So sánh `implementation_plan.md` vs Thực Tế

| Kế hoạch | Trạng thái |
|---|---|
| FastAPI backend với Swagger docs | ✅ Hoàn thành |
| SQLite + Alembic cho metadata | ✅ Schema đầy đủ (users, workspaces, documents, snapshots, conversations, messages) |
| LanceDB vector store phân workspace | ✅ Hoàn thành |
| Docling document parser | ✅ Hoàn thành (với Singleton pattern) |
| LangGraph StateGraph | ✅ Cấu trúc đúng nhưng node `planner` chưa dùng LLM |
| SSE streaming chat | ✅ Đúng spec |
| Next.js 15 split-screen layout | ✅ Hoàn thành |
| Workspace Sidebar với file management | ✅ Hoàn thành |
| Chat Panel với SSE parsing | ✅ Hoàn thành (tốt) |
| Tiptap Rich Text Editor | ✅ Có nhưng chưa review chi tiết |
| PDF Viewer với citation jump | ✅ Hoàn thành (canvas + highlight) |
| `hooks/use-socket-sse.ts` | ❌ **Thiếu** — Kế hoạch đề xuất custom hook nhưng SSE logic nằm thẳng trong ChatPanel |
| `document-viewer.tsx` (tên trong plan) | ⚠️ Đổi tên thành `pdf-viewer.tsx` — không critical |
| Sub-queries từ LLM (Planner Node) | ❌ **Chưa thực hiện** — Dùng regex |
| Parallel retrieval | ❌ **Chưa thực hiện** — Loop tuần tự |
| Context budget / history trimming | ❌ **Chưa thực hiện** — Config có `summarize_history_after_tokens` nhưng không có code |
| Human-in-the-loop (ask_user node) | ⚠️ Có nhưng trigger false positive do regex |

### So sánh `codex_backend_brief.md` §6 (Code Review Requests) vs Thực Tế

| Yêu cầu §6.x | Trạng thái |
|---|---|
| §6.1: Chuyển sang LangGraph thực sự | ⚠️ **Nửa vời** — Graph đúng nhưng `_plan()` vẫn là regex |
| §6.2: Thu thập page_label từ Docling | ✅ **Đã sửa** — `_item_page_label()` đọc `prov[0].page_no` |
| §6.3: Singleton DocumentConverter | ✅ **Đã sửa** — `@lru_cache(maxsize=1)` |
| §6.4: JWT authentication | ✅ **Đã sửa** — `get_current_user` dependency + `auth_required` flag |
| §6.5: `LLAMA_AUTO_ROOT` env var | ✅ **Đã sửa** — `llama_auto_root` trong config với fallback path list |

---

## 4. KIẾN TRÚC — Những Điểm Không Có Trong Plan Nhưng Cần Thảo Luận

### 4.1 Port Mapping Confusing

Backend FastAPI chạy port `8088` nhưng cả `codex_backend_brief.md` và `implementation_plan.md` đều nói "Chat Server (Port 8000)". Hiện tại:
- `8000` = llama-server chat
- `8001` = llama-server embedding
- `8088` = FastAPI app

Frontend `api.ts` cần được kiểm tra xem đang trỏ port nào.

### 4.2 Thiếu: Conversation history trong context khi chat

`stream_chat()` trong agent nhận `message` nhưng không đọc lại `chat_messages` cũ từ DB để đưa vào LLM prompt. User không thể refer đến câu trả lời trước ("Cái vừa nói đó, giải thích thêm đi").

### 4.3 Thiếu: DELETE document + cleanup LanceDB

Không có API `DELETE /workspaces/{id}/documents/{doc_id}`. Khi user xóa file trong sidebar, không có cách nào xóa vector embeddings tương ứng trong LanceDB.

---

## 5. DANH SÁCH ƯU TIÊN XỬ LÝ

### 🔴 Priority P0 — Chặn deploy

1. **`agent.py`**: Thay `_plan()` bằng LLM call để generate sub-queries
2. **`agent.py`**: Giải quyết BUG-03 (fake streaming) — tách writer node ra ngoài `ainvoke`
3. **Frontend**: Thêm JWT token management (`localStorage` + header injection)

### 🟡 Priority P1 — Ảnh hưởng chất lượng

4. **`agent.py`**: Thay `_rerank()` bằng semantic re-ranking (dùng embedding cosine similarity ít nhất)
5. **`agent.py`**: Fix `_needs_user_clarification()` — giới hạn chỉ check các label kinh tế/số liệu
6. **`chat-panel.tsx`**: Thay custom Markdown parser bằng `react-markdown`
7. **`ingestion.py`**: Thêm `logging.exception()` trong except block

### 🟢 Priority P2 — Nice to have

8. Thêm conversation history trong chat prompt
9. Implement `DELETE /documents/{id}` API
10. Thêm toast notification cho errors ở frontend
11. Pin `requirements.txt` với version cụ thể

---

## 6. KẾT LUẬN

**Điểm mạnh nhất của codebase hiện tại:** `LlamaProcessManager` được implement rất kỹ (hardware detection, GPU layer calc, auto-restart). Đây là phần phức tạp nhất và đã làm đúng.

**Điểm yếu nhất:** Node `planner` trong LangGraph — đây là trái tim của "Agentic RAG" nhưng đang dùng regex 2 dòng. Không có LLM call nào trong planning → hệ thống thực chất đang hoạt động như **Naive RAG** chứ không phải Agentic RAG.

**Kết luận tổng thể:** Codebase có nền tảng vững, có thể build tiếp. Cần tập trung fix P0 items trước để có MVP hoạt động đúng chức năng core.
