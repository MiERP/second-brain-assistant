# Báo Cáo Đánh Giá Codebase Round 2: Second Brain Assistant

> **Ngày đánh giá:** 06/06/2026 22:15 | **Reviewer:** Antigravity
> **Baseline:** Review Round 1 (06/06/2026 14:14)
> **Phạm vi:** So sánh trước/sau sửa lỗi, phát hiện vấn đề mới

---

## TL;DR

Đây là một đợt cải thiện **thực chất và đúng hướng**. 4/5 P0 blocker từ round 1 đã được sửa đúng cách. Codebase hiện tại đã đủ điều kiện gọi là **Agentic RAG thật sự** về mặt kiến trúc. Tuy nhiên phát sinh **4 vấn đề mới** (bao gồm 1 P0 critical) và vẫn còn **3 vấn đề chưa được giải quyết** từ round 1.

Điểm tổng hợp: **7.4/10** (từ 4.8/10 round 1, tăng +2.6 điểm)

---

## 1. TỔNG KẾT FIX — So Sánh Trước/Sau

### Đã Sửa Đúng (P0 Resolved)

| Bug ID | Vấn đề cũ | Giải pháp mới | Đánh giá |
|--------|-----------|---------------|----------|
| BUG-01 | `_plan()` dùng regex, không gọi LLM | `llm.plan_sub_queries()` gọi thật llama-server, parse JSON, fallback regex | ĐÚNG CHUẨN |
| BUG-02 | `_rerank()` term-frequency overlap | `_cosine()` tính cosine similarity thật | ĐÚNG CHUẨN |
| BUG-03 | Fake streaming — `ainvoke()` block rồi mới yield | Tách writer ra ngoài graph, stream trực tiếp `llm.stream_completion()` | ĐÚNG CHUẨN |
| BUG-04 | `_needs_user_clarification()` false positive cao | Whitelist `DISCREPANCY_LABEL_KEYWORDS` + blacklist `IGNORED_DISCREPANCY_LABELS` | CẢI THIỆN |
| FE-BUG-03 | `activeWorkspaceId` default `"default"` gây 404 | Đổi thành `""` empty string | ĐÃ SỬA |

### Đã Sửa Đúng (P1/P2 Resolved)

| Bug ID | Vấn đề cũ | Giải pháp mới | Đánh giá |
|--------|-----------|---------------|----------|
| FE-BUG-01 | Markdown parser regex đơn giản | Viết lại hoàn toàn: code blocks, headings H1-H3, lists, blockquote, italic, inline code | XUẤT SẮC |
| WARN-02 | ingestion.py nuốt exception | Thêm `logger.exception(...)` với stacktrace | ĐÃ SỬA |
| FE-WARN-02 | Không có Toast | Tạo `lib/toast.tsx` với ToastProvider, useToast hook, framer-motion animation | XUẤT SẮC |
| FE-BUG-03 | Thiếu conversation history | `_conversation_history()` đọc 12 messages từ DB, đưa vào prompt | ĐÃ SỬA |

### Chưa Giải Quyết Từ Round 1

| Bug ID | Vấn đề | Ghi chú |
|--------|---------|---------|
| FE-BUG-02 | Mọi fetch() thiếu Authorization header | `auth_required=False` đang ẩn vấn đề |
| WARN-04 | JWT tự implement, rủi ro subtle bugs | Chưa dùng PyJWT |
| WARN-05 | requirements.txt version pinning lỏng | Chưa pin version |

---

## 2. BACKEND — Phân Tích Mới (Round 2)

### Điểm Tốt Mới

**Parallel Retrieval thật sự** — `asyncio.gather(*tasks)` embed và search LanceDB đồng thời cho từng sub-query. Đúng theo brief §3.

**Cosine Similarity Reranking** — Pure Python `_cosine()`, không phụ thuộc numpy/scipy. Phù hợp môi trường local-first offline.

**LLM Sub-query Planning** — `plan_sub_queries()` gọi llama-server, parse JSON `{"queries": [...]}` với double-parse fallback robust.

**Conversation History** — Đọc 12 messages gần nhất từ DB, reverse chronological, đưa vào `_build_prompt()`.

---

### Vấn Đề Mới Phát Sinh (Round 2)

#### NEW-BUG-01 [P0]: `_cosine()` nhận sai kiểu dữ liệu từ LanceDB

File: agent.py#L174-178

```python
row_copy["_score"] = self._cosine(vector, row_copy.get("vector", []))
```

**Vấn đề:** LanceDB `.to_list()` trả về cột `vector` là `numpy.ndarray` hoặc `pyarrow.array`, KHÔNG phải Python list. Hàm `_cosine()` nhận vào và `float(right[index])` sẽ không lỗi nhưng kết quả sai hoặc 0.0 vì numpy array không iter đúng trong Python list comprehension thuần.

**Hậu quả:** Toàn bộ `_score=0.0` → `_rerank()` sort không có tác dụng → chunks kém liên quan có thể lọt vào context.

**Fix:** Trong `_retrieve_query`, thêm `row_copy.get("vector")` → convert về list: `v = row.get("vector"); list(v) if v is not None else []`.

---

#### NEW-BUG-02 [P1]: History bị truncate 2 lần, không có context budget

File: agent.py#L297-299

```python
history_text = "\n".join(
    f"{item['role']}: {item['content'][:1000]}" for item in history[-8:]
)
```

`_conversation_history()` lấy `limit(12)` messages, nhưng `_build_prompt()` lại slice thêm `[-8:]` → chỉ còn 8. Hai nơi control limit không đồng bộ.

Brief §3 yêu cầu tóm tắt history khi >8000 tokens — chưa có bất kỳ token counting nào.

---

#### NEW-BUG-03 [P1]: `planner_node` không nhận history → refer-back queries thất bại

File: agent.py#L156-158

```python
async def _planner_node(self, state: AgentState) -> AgentState:
    sub_queries = await self.llm.plan_sub_queries(state["message"])
```

`plan_sub_queries()` chỉ nhận `state["message"]`, không có `state["history"]` → khi user hỏi "Chi tiết hơn về điều đó?" → LLM không biết "điều đó" là gì → sub-queries vô nghĩa.

**Fix:** Truyền N-last messages của history vào prompt của `plan_sub_queries()`.

---

#### NEW-BUG-04 [P2]: `toast.tsx` import framer-motion cho animation nhỏ

`framer-motion@12.40.0` (~50KB gzipped) chỉ được dùng cho fade-in/out toast. CSS `@keyframes` là đủ và nhẹ hơn nhiều. Không ảnh hưởng chức năng nhưng làm bundle nặng không cần thiết.

---

### Vấn Đề Nhỏ Còn Lại

**MINOR-01:** `_is_meaningful_metric_label()` dùng `keyword in label` — substring match có thể false positive ("costumer" match "cost"). Nên dùng word-boundary regex.

**MINOR-02:** `_build_prompt()` system instruction dùng Vietnamese không dấu: `"Ban la tro ly nghien cuu..."` → LLM có thể không hiểu và respond bằng tiếng Anh. Nên dùng UTF-8 hoặc English hoàn toàn.

**MINOR-03:** `context_builder_node` là node dư trong graph — chỉ gọi `_build_prompt()`, không có conditional logic. Có thể chuyển về `stream_chat()` sau `ainvoke()`.

---

## 3. FRONTEND — Phân Tích Mới (Round 2)

### Điểm Tốt Mới

**Markdown Renderer hoàn chỉnh:** Code blocks với copy button, H1/H2/H3, ordered/unordered lists, blockquotes, horizontal rule, bold, italic, inline code, inline citations [n] là clickable buttons.

**react-resizable-panels:** Drag resize giữa chat panel và editor. UX tốt hơn layout cũ.

**Toast System:** ToastProvider wrap toàn app trong layout.tsx. Mọi fetch error trong sidebar và chat đều hiện toast.

**Rich Editor (Tiptap):** Table resizable, TextAlign, Highlight, Image, HorizontalRule. Toolbar đầy đủ. Autosave debounce 2 giây.

---

### Vấn Đề Frontend Mới

#### NEW-FE-BUG-01 [P1]: Markdown renderer không handle bảng

```
| Tiêu chí | Tesla | BYD |
|----------|-------|-----|
| Năng lượng | 272 Wh/kg | 150 Wh/kg |
```

Với use case nghiên cứu so sánh (Tesla vs BYD), LLM thường trả về bảng. Không có table rendering → `|` characters hiển thị như plain text → báo cáo trông xấu và không dùng được.

---

#### NEW-FE-BUG-02 [P1 CRITICAL]: `handleSaveEditorContent` chỉ là stub — mất toàn bộ nội dung khi refresh

File: workspace-layout.tsx#L73-76

```typescript
const handleSaveEditorContent = useCallback((htmlContent: string) => {
    // In production, send to FastAPI endpoint...
    console.log("Autosaving editor content...", htmlContent.slice(0, 100));
}, []);
```

`document_snapshots` table đã có trong backend schema (ingestion.py#L107-112 lưu parsed Markdown). Nhưng KHÔNG CÓ API endpoint để save editor content và KHÔNG CÓ API để load lại. Refresh page → mất toàn bộ báo cáo đã soạn.

**Đây là chức năng core differentiator của app** (Chat → Draft → Save → Version) nhưng đang hoàn toàn là stub.

---

#### NEW-FE-BUG-03 [P2]: `insertContent()` nhận Markdown thuần → Tiptap render raw text

File: rich-editor.tsx#L80

```typescript
editor.chain().focus().insertContent(insertedText.text).run();
```

Tiptap `insertContent()` nhận HTML hoặc ProseMirror JSON. Truyền Markdown thuần → ký tự `**`, `#`, `-` hiển thị y nguyên. "Đẩy sang Editor" → nội dung không được format → editor unusable.

**Fix:** Parse Markdown thành HTML bằng `marked` trước khi `insertContent()`.

---

## 4. COMPLIANCE MATRIX (Cập Nhật)

| Feature | Round 1 | Round 2 |
|---------|---------|---------|
| FastAPI + SQLite + Alembic | DONE | DONE |
| LanceDB phân workspace | DONE | DONE |
| Docling với page_label | DONE | DONE |
| LangGraph StateGraph | PARTIAL | DONE |
| LLM sub-query planning | MISSING | DONE |
| Parallel retrieval asyncio | MISSING | DONE |
| Cosine similarity reranking | MISSING | DONE (có bug type) |
| SSE real-time streaming | FAKE | DONE |
| Conversation history | MISSING | DONE |
| Context budget / trim history | MISSING | MISSING |
| Human-in-the-loop ask_user | BUGGY | IMPROVED |
| Resizable split-screen | FIXED | DRAG |
| Markdown renderer | BASIC | GOOD (no table) |
| Toast notifications | MISSING | DONE |
| Save editor → backend | MISSING | STUB ONLY |
| Delete document API | MISSING | MISSING |
| Auth token in frontend headers | MISSING | MISSING |

---

## 5. PRIORITY LIST — Giai Đoạn 3

### P0 — Phải Fix Ngay

1. agent.py: Convert LanceDB vector từ numpy → list trước khi gọi `_cosine()`
2. workspace-layout.tsx + backend: Implement Save Report API + load lại content khi mở workspace
3. rich-editor.tsx: Parse Markdown → HTML trước khi `insertContent()` (dùng `marked`)

### P1 — Ảnh Hưởng Chất Lượng

4. chat-panel.tsx / renderMessageContent: Thêm table rendering
5. llm_client.py plan_sub_queries: Truyền history vào prompt để handle refer-back queries
6. agent.py: Implement context budget — count chars và truncate history smart hơn
7. schemas.py: Xóa `filepath` khỏi DocumentRead public response

### P2 — Nice to Have

8. toast.tsx: Thay framer-motion bằng CSS animation thuần
9. agent.py: Fix prompt strings về UTF-8 Vietnamese hoặc English hoàn toàn
10. backend: DELETE /documents/{id} API với LanceDB cleanup
11. frontend: Tách SSE logic ra hook `use-sse-stream.ts`
12. requirements.txt: Pin version sau khi test ổn định

---

## 6. KẾT LUẬN

### Điểm Số

| Hạng mục | Round 1 | Round 2 | Delta |
|----------|---------|---------|-------|
| Backend Architecture | 6/10 | 8/10 | +2 |
| Agentic RAG Quality | 3/10 | 7/10 | +4 |
| Frontend UX | 5/10 | 7/10 | +2 |
| Code Quality | 6/10 | 8/10 | +2 |
| Compliance với Docs | 4/10 | 7/10 | +3 |
| **TỔNG** | **4.8/10** | **7.4/10** | **+2.6** |

### Nhận Xét Cuối

Cải thiện lớn nhất là **Agentic RAG quality** (+4 điểm). LLM planning, parallel retrieval, cosine reranking, real streaming đã biến app từ "Naive RAG" thành "Agentic RAG thật sự".

**Điểm yếu nhất còn lại:** Core loop **Chat → Draft → Save** bị đứt gãy tại bước Save. `handleSaveEditorContent` chỉ là `console.log()`. Đây là tính năng differentiator so với chat PDF thông thường.

**Kết luận:** MVP demo được cho flow: Upload → Chat → Citation → "Đẩy sang Editor" → Chỉnh sửa thủ công. Giai đoạn 3 phải tập trung vào Save/Version loop để hoàn thiện core value proposition.
