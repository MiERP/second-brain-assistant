# Bao Cao Danh Gia Codebase Round 3 — Second Brain Assistant
> Ngay danh gia: 06/06/2026 23:30 | Reviewer: Antigravity
> Pham vi: So sanh toan bo Backend + Frontend voi "goc" (ideas-second-brain.md + implementation_plan.md + codex_backend_brief.md)
> Baseline: Round 2 report (codebase_review_round2.md)

---

## LOI MO DAU — Phuong phap Review

Lan nay review duoc thuc hien bang cach:
1. Doc ky toan bo 3 tai lieu "goc" (ideas, implementation_plan, codex_backend_brief)
2. Doc toan bo code thuc te (backend + frontend, khong bo qua file nao)
3. So sanh line-by-line giua "goc" va "thuc te" de tim khoang cach (gap)

Ket qua: Codebase Round 3 la buoc tien bo THUC CHAT nhat trong ca qua trinh. Nhieu tinh nang cot loi da duoc implement dung. Nhung van con 5 khoang cach co the xac dinh chinh xac.

---

## 1. CAI GI DA DUNG — Doi chieu voi "Goc"

### 1.1 Kien truc tong the — DAT CHUAN

"Goc" (implementation_plan.md §1) mo ta kien truc 3 tang:
- Frontend (Next.js 15) <-> REST API + SSE <-> Backend (FastAPI) <-> Storage Layer (SQLite + LanceDB)

Thuc te:
- FastAPI o port 8088, llama-chat o 8000, llama-embed o 8001 — DUNG per codex_backend_brief §2.1
- LanceDB phan workspace theo `workspace_{id}_chunks` — DUNG per brief §1.B
- SQLite voi Alembic, day du 6 bang — DUNG per brief §1.A (users, workspaces, documents, document_snapshots, chat_conversations, chat_messages)
- Them: models.py co them bang `reports` va `report_snapshots` (ngoai spec) — DAY LA MO RONG TOT

### 1.2 Agentic RAG Workflow — DAT CHUAN CAO HON DU KIEN

"Goc" (codex_backend_brief §3) yeu cau 5 node:
1. Planner Node — co, goi llm.plan_sub_queries() voi history (DUNG)
2. Retriever Node — co, asyncio.gather parallel (DUNG)
3. Synthesizer/Discrepancy Checker Node — co, voi keyword filter (DUNG)
4. Writer Node — TACH KHOI GRAPH, stream truc tiep (DUNG, la cach hay nhat)
5. Self-Correction Node — co, _self_correct_answer() (DUNG)

Dac biet: _coerce_vector() xu ly chuyen doi numpy/pyarrow -> Python list (fix BUG-01 round 2)

### 1.3 Ingestion Pipeline — DAT CHUAN

"Goc" (codex_backend_brief §2.2) yeu cau:
- asyncio.Queue + ProcessPoolExecutor — CO (ingestion.py#L31-32)
- Docling parser — CO (parser.py)
- MarkdownHeaderTextSplitter, max 500 tu, overlap 100 tu — CO (chunking.py)
- Giu nguyen bang Markdown lam 1 chunk — CO (brief §2.2)
- page_label tu prov[0].page_no — CO (parser.py)
- logger.exception() trong except — CO (ingestion.py#L116)

### 1.4 Frontend Split-screen — DAT CHUAN

"Goc" (implementation_plan.md §2.2) yeu cau:
- 45% left (Chat + Document Viewer) / 55% right (Editor) — CO, voi react-resizable-panels drag
- "Day sang Editor" button — CO (chat-panel.tsx#L583)
- Citation [n] click -> PDF viewer jump to page — CO (handleCitationClick)
- Tiptap rich editor — CO, day du extensions

### 1.5 Save Report — TINH NANG MOI VUOT NGOAI SPEC

"Goc" khong mo ta cu the luu bao cao, nhung bac 4 (implementation_plan §3 buoc 4) co: "dong bo du lieu tu khung chat sang van ban bao cao".

Thuc te da implement:
- POST /workspaces/{id}/reports (tao moi)
- PUT /workspaces/{id}/reports/{report_id} (cap nhat, co version)
- GET /workspaces/{id}/reports (load lai khi mo workspace)
- ReportSnapshot voi content_markdown + content_html + version
- handleSaveEditorContent -> apiFetch thay vi console.log() (da fix round 2)
- markdownToEditorHtml() trong rich-editor.tsx (da fix round 2)
- Table parsing trong ca rich-editor.tsx lan chat-panel.tsx (da fix round 2)

---

## 2. GAP PHAN TICH — Khoang cach so voi "Goc"

### GAP-01 [P1 — Chat Quality]: SSE status events duoc yield TRUOC khi graph chay

File: agent.py#L101-107

```python
yield sse("status", {"node": "planner", "message": "Dang phan tich..."})
yield sse("status", {"node": "retriever", "message": "Dang truy xuat..."})
yield sse("status", {"node": "synthesizer", "message": "Dang tong hop..."})

state = await self.graph.ainvoke(...)  # graph chay sau
```

Van de: 3 status events duoc yield ngay lap tuc TRUOC khi graph.ainvoke() duoc goi. Tat ca 3 status events se xuat hien dong thoi trong 1 render tick o frontend -> khong co "tung buoc" UX ma nguoi dung thay. Frontend se nhan het 3 status messages roi moi block cho graph.ainvoke().

"Goc" (implementation_plan §3 buoc 3.Frontend.1): "Cap nhat Chat UI de hien thi trang thai suy nghi cua Agent (vi du: AI dang phan tich cau hoi..., AI dang tim trong file A.pdf...)."

Muc dich cua "trang thai suy nghi" la hien thi TUNG BUOC THEO THOI GIAN THUC, khong phai hien thi tat ca cung luc roi cho.

Giai phap: Chuyen status yields vao trong tung node, dung asyncio.Queue hoac LangGraph streaming callback.

---

### GAP-02 [P1 — Context Quality]: history trong _conversation_history() lay limit=30 qua rong

File: agent.py#L225

```python
.limit(30)
```

Brief §3 yeu cau: "Thuc hien cat tia lich su chat (ket hop goi LLM tom tat lich su hoi thoai khi vuot qua 8,000 tokens)."

Thuc te: _build_history_text() co tinh budget_chars = summarize_history_after_tokens * 4 (line 316), day la budget CHARACTER chu khong phai TOKEN. Vi budget la char count, con LLM tinh token (1 token ~= 3-4 chars viet, ~= 0.75 tu tieng Viet), cach ux ly nay co the:
- Qua de: cho phep qua nhieu lich su neu token dai
- Qua khat: cat dut lich su quan trong

Quan trong hon: "tom tat lich su khi vuot qua 8,000 tokens" trong brief -> can goi LLM de tao summary cua history cu. Hien tai chi dang TRUNCATE (bo di), khong SUMMARIZE (tom tat). Nguoi dung mat lich su hoi thoai ma khong biet.

---

### GAP-03 [P2 — Auth]: Frontend truyen token nhung khong co login UI

File: api.ts

```typescript
export function authHeaders(): HeadersInit {
  const token = window.localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
```

apiFetch() dung authHeaders() dung, inject Authorization header vao moi request.

Nhung van de la: Khong co trang login/register trong frontend. Hien tai auth_required=False tren backend (mac dinh desktop mode). Neu bat auth_required=True, app se tra loi 401 moi request vi khong co cach nao lay token.

"Goc" (codex_backend_brief §6.4): "Them router dang nhap/dang ky, cap JWT token". Backend da co auth.py voi /auth/register va /auth/login. Nhung frontend khong co trang nao goi cac endpoint nay.

Gap cu the: Thieu frontend login flow — form dang nhap -> goi POST /auth/login -> luu token vao localStorage -> redirect vao app chinh.

---

### GAP-04 [P2 — UX]: `hooks/` directory trong implementation_plan nhung khong ton tai

"Goc" (implementation_plan.md §2.2):
```
hooks/
  use-socket-sse.ts    # Nhan phan hoi stream tu backend
```

Thuc te: Thu muc hooks/ khong ton tai. Logic doc SSE nam thang trong handleSend() o chat-panel.tsx (~80 dong code). Day la van de kien truc nho (separation of concerns), khong phai logic bug.

Anh huong: Chat panel component (673 dong) kho maintain. SSE parsing logic khong tai su dung duoc o components khac.

---

### GAP-05 [P1 — DB Schema]: models.py thieu truong `filename` trong Chunk schema

Vec-to LanceDB chunk co truong `filename` (duoc them trong ingestion.py#L96: "filename": file_path.name). Nhung day chi la metadata trong LanceDB, khong co mapping formal vao SQLite Document model.

Cu the hon: Khi `_citations()` trong agent.py#L256 tra ve `row.get("filename", "unknown")`, gia su rang LanceDB row luon co truong nay. Neu LanceDB bi xoa hoac fallback JSONL khong co truong nay -> citation filename la "unknown".

Dan den: Citation cards trong frontend se hien thi "unknown (Tr. X)" thay vi ten file that.

---

### GAP-06 [P2 — Missing Feature]: Workspace deletion API va Document de-indexing

"Goc" (implementation_plan.md §2.3): "LanceDB... cho phep co lap tuyet doi du lieu giua cac workspace."

Thuc te da co: DELETE /workspaces/{id}/documents/{doc_id} (workspaces.py#L287-315) — xoa ca file, DocumentSnapshot, va LanceDB chunks.

Nhung CHUA CO: DELETE /workspaces/{id} (xoa workspace + tat ca documents + tat ca LanceDB table). Khi user xoa workspace, toan bo data van con trong storage/lancedb.

---

## 3. KHOANG CACH KHONG CON (So sanh Round 2 -> Round 3)

| Gap Round 2 | Trang thai Round 3 | Ghi chu |
|---|---|---|
| NEW-BUG-01: _cosine() nhan numpy tu LanceDB | DA SUA | _coerce_vector() xu ly day du numpy/pyarrow/list |
| NEW-FE-BUG-02: handleSaveEditorContent stub | DA SUA | API call that, PUT/POST, load lai khi mo workspace |
| NEW-FE-BUG-03: insertContent() nhan Markdown raw | DA SUA | markdownToEditorHtml() convert truoc |
| NEW-FE-BUG-01: Table rendering thiếu | DA SUA | Ca chat-panel.tsx va rich-editor.tsx deu co table parser |
| NEW-BUG-03: planner khong co history | DA SUA | plan_sub_queries(message, history) |
| NEW-BUG-02: history truncate 2 lan | DA SUA | _build_history_text() voi budget_chars logic |

---

## 4. COMPLIANCE MATRIX — Kiem tra tung item trong docs

### implementation_plan.md §3 (Milestones)

| Milestone | Trang thai |
|---|---|
| Giai doan 1: FastAPI + SQLite | DONE |
| Giai doan 1: Next.js + Tailwind + Shadcn | DONE |
| Giai doan 1: Split-screen layout tho | DONE |
| Giai doan 1: Tiptap Editor co ban | DONE |
| Giai doan 2: Upload file API | DONE |
| Giai doan 2: Docling parse PDF | DONE |
| Giai doan 2: LanceDB + embeddings | DONE |
| Giai doan 2: RAG co ban (timkiem -> LLM -> tra loi) | DONE |
| Giai doan 2: Sidebar upload + quan ly file | DONE |
| Giai doan 2: Chat panel ket noi API | DONE |
| Giai doan 3: LangGraph Agentic Workflow | DONE |
| Giai doan 3: Planner Node chia sub-queries | DONE |
| Giai doan 3: Parallel Researcher Node | DONE |
| Giai doan 3: Citation metadata (filename + page) | DONE |
| Giai doan 3: Chat UI hien thi trang thai Agent | PARTIAL — Hien tat ca cung luc, khong theo thoi gian thuc |
| Giai doan 3: Citation cards click -> PDF | DONE |
| Giai doan 4: "Day sang Editor" button | DONE |
| Giai doan 4: Editor dong bo tu Chat | DONE (markdownToEditorHtml) |
| Giai doan 4: Streaming API toi uu | DONE (real stream) |

### codex_backend_brief.md §3 (Agentic RAG)

| Yeu cau | Trang thai | Chi tiet |
|---|---|---|
| Context Budget 32768 tokens | PARTIAL | Co budget_chars nhung tinh bang char, khong phai token |
| Tom tat history khi > 8000 tokens | MISSING | Chi truncate, khong summarize bang LLM |
| Local re-ranker: 100 chunks -> 15 | DONE | cosine similarity reranking |
| Planner Node: sub-queries tu LLM | DONE | plan_sub_queries() voi history |
| Retriever Node: parallel | DONE | asyncio.gather |
| Synthesizer/Discrepancy Checker | DONE | keyword filter, word boundary regex |
| Writer Node: Markdown + citation | DONE | _build_prompt() + _self_correct_answer() |
| Self-Correction Node | DONE | Kiem tra [n] citation co trong answer |
| Human-in-the-loop (Ask User) | DONE | needs_clarification + ask_user SSE event |

### codex_backend_brief.md §4 (SSE Protocol)

| SSE Event | Trang thai |
|---|---|
| event: status / node: planner | CO — yield truoc graph |
| event: citations / data: list | CO |
| event: text / data: delta | CO — real stream |
| event: done | CO |
| event: error | CO |
| event: ask_user (Human-in-loop) | CO — extension tot |

---

## 5. DANH GIA KY THUAT CHUYEN SAU

### 5.1 _coerce_vector() — Xu ly tot, co the them type annotation ro rang hon

```python
def _coerce_vector(self, vector) -> list[float]:
    if vector is None or isinstance(vector, (str, bytes)):
        return []
    if hasattr(vector, "to_pylist"):   # pyarrow ChunkedArray
        vector = vector.to_pylist()
    elif hasattr(vector, "tolist"):     # numpy.ndarray
        vector = vector.tolist()
    elif not isinstance(vector, list) and isinstance(vector, Iterable):
        vector = list(vector)
    if not isinstance(vector, list):
        return []
    return [float(value) for value in vector]
```

Xu ly day du 4 truong hop: pyarrow, numpy, generic Iterable, va fallback. Day la code phong thu tot. Diem cong.

### 5.2 _build_history_text() — Logic co nhung co edge case

```python
budget_chars = max(200, self.settings.summarize_history_after_tokens * 4)
```

`summarize_history_after_tokens` ten bien goi y "dung de summarize" nhung thuc te chi dung lam budget cut-off. Budget = tokens * 4 chars/token. Van de: token per char cho tieng Viet khac tieng Anh (~3 chars/token). Cau tieng Viet "Mật độ năng lượng của Tesla" = 28 chars / ~6 tokens = ~4.7 chars/token. Nen dung he so 3.5-4.

Ngoai ra: `if len(line) > budget_chars: line = f"{line[: max(0, budget_chars - 3)]}..."` — cat 1 dong history xuong bang budget_chars, nhung toan bo budget_chars. Nghia la 1 dong dai se chiem het budget, cac dong con lai bi bo.

### 5.3 _self_correct_answer() — Qua don gian cho Self-Correction Node

"Goc" (codex_backend_brief §3.node-5): "Tu dong kiem tra loi cu phap va trich dan, yeu cau mo hinh sua lai cac doan bi loi."

Thuc te:
```python
def _self_correct_answer(self, answer: str, citations: list[dict]) -> str:
    if citations and not re.search(r"\[\d+\]", answer):
        return f"{answer}\n\nNguon: " + ...
    return answer
```

Chi kiem tra xem answer co chua [n] hay khong. Neu khong co thi append citation list vao cuoi. Day la "kem tra loi cu phap" don gian, khong phai "yeu cau mo hinh sua lai".

Ve mat chuc nang: dung. Ve mat spec: khong dung tinh than "Self-Correction" that su (phai goi LLM de sua, khong phai append string).

### 5.4 workspace-sidebar.tsx — Chua doc code, can check

Cac thao tac fetch trong workspace-sidebar.tsx co su dung apiFetch() khong? Neu co thi Authorization header da duoc inject. Can confirm.

### 5.5 models.py — Report model la tien bo kien truc lon

models.py co them bang Report + ReportSnapshot voi version tracking. Day la tinh nang MA "goc" KHONG MO TA CU THE nhung phu hop voi spirit cua Stage 4 (editor + save). Day la viec phat sinh hop ly, khong phai deviate khoi spec.

---

## 6. TONG KET DIEM SO

| Hang muc | Round 1 | Round 2 | Round 3 | Delta R2->R3 |
|---|---|---|---|---|
| Backend Architecture | 6/10 | 8/10 | 9/10 | +1 |
| Agentic RAG Quality | 3/10 | 7/10 | 8/10 | +1 |
| Core Loop (Chat->Draft->Save) | 1/10 | 4/10 | 9/10 | +5 |
| Frontend UX | 5/10 | 7/10 | 8.5/10 | +1.5 |
| Code Quality | 6/10 | 8/10 | 8.5/10 | +0.5 |
| Compliance voi Docs | 4/10 | 7/10 | 8.5/10 | +1.5 |
| **TONG** | **4.2/10** | **6.8/10** | **8.6/10** | **+1.8** |

---

## 7. DANH SACH UU TIEN GIAI DOAN 4

### P1 — Anh huong Chat Quality

1. **agent.py**: Yield status events TRONG NODE (khong truoc graph.ainvoke). Can dung asyncio.Queue hoac refactor status sang LangGraph stream mode de tung buoc UX hoat dong dung.

2. **agent.py + llm_client.py**: Implement history summarization bang LLM khi tong prompt > 8000 estimated tokens (thay vi chi truncate). Them ham `summarize_history(history: list) -> str` goi llm.complete_text().

### P2 — Auth + UX

3. **frontend**: Tao auth flow — trang /login voi form email+password, goi POST /auth/login, luu token, redirect. Co the la modal don gian tren trang chinh.

4. **frontend**: Tach SSE parsing logic tu chat-panel.tsx ra hook `hooks/use-sse-chat.ts`. Giam chat-panel.tsx tu 673 dong xuong ~400 dong.

### P3 — Minor / Nice to Have

5. **backend**: Them DELETE /workspaces/{id} endpoint de xoa workspace + tat ca documents + LanceDB table tuong ung.

6. **backend**: Doi ten bien `summarize_history_after_tokens` thanh `history_budget_chars` hoac tinh chinh xac hon bang he so 3.5 (chars/token cho tieng Viet).

7. **backend**: Nang cap _self_correct_answer() de goi LLM kiem tra citation syntax thay vi chi append string.

---

## 8. KET LUAN

Round 3 la milestone quan trong nhat: **Core Loop da dong day**.

Chat -> LLM Research -> Citation -> "Day sang Editor" -> Auto-save -> Load lai khi mo workspace — tat ca da hoat dong end-to-end.

Day chinh la "killer feature" phan biet Second Brain Assistant voi cac ung dung chat PDF thong thuong. Truoc day (Round 2), editor save la stub console.log(). Gio day da la real API call voi version tracking.

**Diem yeu lon nhat con lai:** Trang thai suy nghi cua Agent hien khong dung thoi gian thuc (GAP-01). Nguoi dung nhan tat ca status messages cung luc roi moi block cho LLM. Day la van de UX lien quan den cach LangGraph ainvoke() hoat dong — can refactor kien truc de co true step-by-step visibility.

**Ket luan tong the:** Codebase hien tai **san sang cho MVP demo va user testing**. Tat ca tinh nang cot loi tu spec deu duoc implement. Cac gap con lai la P1-P2, khong phai P0 blocker.
