# Báo Cáo Đánh Giá Codebase Round 4 — Second Brain Assistant

> **Ngày đánh giá:** 06/06/2026 | **Reviewer:** Antigravity (AI Architect)
> **Đối chiếu gốc:** `docs/ideas-second-brain.md`, `docs/implementation_plan.md`, `reviews/codex_backend_brief.md`
> **Baseline:** Báo cáo Round 3 (`reviews/codebase_review_round3.md`)

---

## 1. PHƯƠNG PHÁP ĐỐI CHIẾU (Review Methodology)

Đợt đánh giá Round 4 này được tiến hành tập trung vào việc **so sánh đối chiếu thực tế codebase hiện tại với các tài liệu định hướng gốc** để tìm ra những điểm "gap" (khoảng cách) về tính năng và kiến trúc. Các tài liệu gốc bao gồm:
1. `docs/ideas-second-brain.md` (Ý tưởng kiến trúc Agentic RAG và Killer Features).
2. `docs/implementation_plan.md` (Kế hoạch triển khai chia đôi màn hình và cơ chế đồng bộ).
3. `reviews/codex_backend_brief.md` (Đặc tả các node LangGraph, SSE Protocol và Dual-server local).

---

## 2. TIẾN TRÌNH & ĐIỂM SÁNG LỚN (Overall Progress)

Codebase đã khắc phục được hầu hết các lỗi chí tử từ các vòng đánh giá trước (như lỗi cosine similarity nhận numpy array, lỗi fake stream, lỗi missing history, và các API report lưu trữ stub).
- **Core Loop Hoàn Chỉnh:** Chuỗi tác vụ `Upload PDF -> Docling parsing -> Vectorize & Store -> Chat & Planning -> Parallel Retrieval -> Rerank -> Stream response -> Apply to Editor -> Autosave versioning -> Load report` đã chạy mượt mà end-to-end.
- **Tiến trình real-time thực tế:** GAP-01 của Round 3 đã được khắc phục. Backend sử dụng `graph.astream()` và yield status sự kiện tương ứng ngay sau khi các node kết thúc, giúp UI hiển thị cây log suy luận (thought logs tree) từng bước thực tế theo thời gian thực thay vì hiện hàng loạt cùng một lúc.
- **Quản lý lịch sử hội thoại thông minh:** Tránh tràn context prompt bằng cách ước lượng token (`len/4`) và gọi LLM `summarize_history` cho các tin nhắn cũ, giữ nguyên các tin nhắn mới nhất trong budget.

---

## 3. PHÂN TÍCH KHOẢNG CÁCH (Gaps Analysis - "Thực tế vs Gốc")

Mặc dù hệ thống đã hoạt động rất tốt cho luồng demo cơ bản, việc so sánh trực tiếp với **tài liệu gốc** chỉ ra **5 khoảng cách (Gaps) lớn** dưới đây:

### GAP-01 [Human-in-the-loop / Ask User — Bị đứt gãy ở Frontend]
- **Thiết kế Gốc:** Tài liệu ý tưởng (`ideas-second-brain.md` §4.4) và đặc tả backend (`codex_backend_brief.md` §3.node-3) yêu cầu: khi phát hiện dữ liệu/số liệu mâu thuẫn chéo giữa các file nguồn (ví dụ: File A ghi doanh thu 10 tỷ, File B ghi 12 tỷ), Agent phải kích hoạt node `Ask User` (Human-in-the-loop) dừng luồng và gửi câu hỏi để người dùng lựa chọn trước khi viết tiếp.
- **Thực tế:**
  - Backend đã implement logic phát hiện mâu thuẫn `_needs_user_clarification()`, định tuyến đồ thị LangGraph sang node `ask_user` và yield SSE event `event: ask_user`.
  - Tuy nhiên, **Frontend hoàn toàn bỏ qua sự kiện này**. Trong custom hook `use-sse-chat.ts` (dòng 47-58) và component `chat-panel.tsx` không hề có handler hay callback nào cho `ask_user`.
- **Hậu quả:** Khi có mâu thuẫn số liệu, stream chat sẽ tự động kết thúc im lặng ở phía người dùng, không hiển thị bất kỳ thông báo hay lựa chọn nào để người dùng phản hồi. Luồng tương tác bị kẹt.

### GAP-02 [Clickable Citation hyperlink trong Editor — Chưa hỗ trợ]
- **Thiết kế Gốc:** Kế hoạch triển khai (`implementation_plan.md` §2.2.2) ghi rõ: *"Tính năng trích dẫn (Citations) dạng hyperlink: Click vào số trích dẫn `[1]` trong bài viết bên Editor sẽ tự động mở xem thử tài liệu nguồn bên trái và nhảy đến phân đoạn gốc."*
- **Thực tế:**
  - Chat panel bên trái hỗ trợ click citation `[1]` để nhảy trang PDF Viewer rất tốt.
  - Nhưng bên Editor (Tiptap ở cột phải), khi bấm nút "Đẩy sang Editor", nội dung chứa các nhãn trích dẫn dạng `[1]`, `[2]` được chèn vào dưới dạng text thường tĩnh. Editor `renderInlineMarkdown` chỉ parse định dạng bold/italic/code, hoàn toàn không biến `[n]` thành nút tương tác hay link có thể click.
- **Hậu quả:** Người dùng khi đọc và chỉnh sửa báo cáo bên phải không thể nhấn vào các nguồn tham khảo để đối chiếu tức thì với văn bản gốc bên trái.

### GAP-03 [Mất định dạng Markdown khi tự động lưu Report]
- **Thiết kế Gốc:** Trình soạn thảo Rich Text lưu trữ các bản nháp báo cáo dạng Markdown định dạng chuẩn (để đồng bộ, export hoặc cho LLM đọc hiểu lại).
- **Thực tế:**
  - Khi Editor autosave, hàm `handleSaveEditorContent` trong `workspace-layout.tsx` (dòng 136) gọi helper `htmlToPlainText(htmlContent)` để sinh trường `content_markdown`.
  - Helper này sử dụng regex `htmlContent.replace(/<[^>]+>/g, " ")` để **xóa sạch toàn bộ thẻ HTML**. Việc xóa thô sơ này làm biến mất hoàn toàn cấu trúc Markdown (biến tiêu đề `<h2>` thành text thường, phá hủy cấu trúc các bảng biểu `<table>` thành chuỗi ký tự dính nhau, làm mất ký tự `**` hay `-` của danh sách).
- **Hậu quả:** Snapshot của báo cáo trong SQLite luôn lưu một phiên bản `content_markdown` trống định dạng, phẳng lì. Mặc dù reload giao diện vẫn chạy tốt (vì sử dụng `content_html` được lưu nguyên vẹn), nhưng dữ liệu Markdown lưu trữ hoàn toàn vô dụng cho việc xử lý tiếp hoặc export.

### GAP-04 [Thiếu UI để Xóa Workspace và Tài liệu nguồn]
- **Thiết kế Gốc:** Người dùng có toàn quyền quản lý bộ nhớ tri thức, thêm/xóa file và workspace cô lập.
- **Thực tế:**
  - Backend đã xây dựng đầy đủ các endpoint: `DELETE /workspaces/{workspace_id}` (xóa sạch DB meta, report snapshots và thư mục file vật lý cùng bảng LanceDB) và `DELETE /workspaces/{workspace_id}/documents/{document_id}` (xóa file và dọn dẹp chỉ mục vector).
  - Nhưng trên giao diện sidebar của Frontend (`workspace-sidebar.tsx`), **không có bất kỳ nút hoặc UI click nào** để kích hoạt hành động xóa tài liệu hoặc xóa workspace.
- **Hậu quả:** Hệ thống sẽ tích tụ rác dữ liệu trên ổ đĩa local mà người dùng không thể dọn dẹp qua UI.

### GAP-05 [Self-Correction Node chỉ là Post-processing Rule tĩnh]
- **Thiết kế Gốc:** Đặc tả LangGraph (§3.node-5) yêu cầu: node tự động kiểm tra lỗi cú pháp và trích dẫn, yêu cầu mô hình (LLM) viết lại các phần bị lỗi (Agentic feedback loop).
- **Thực tế:**
  - Logic Self-correction nằm ngoài đồ thị LangGraph. Nó được gọi thủ công bằng hàm Python `_self_correct_answer` ở cuối tiến trình. Hàm này chỉ chạy regex kiểm tra xem có ký tự trích dẫn `[n]` hay không, nếu không thì append thêm danh sách text tĩnh ở cuối. Không có vòng lặp LLM tự sửa lỗi.
- **Hậu quả:** Thiếu tính linh hoạt của Agentic RAG thực sự; nếu LLM trích dẫn sai số trang hoặc sai tên file, hàm regex này không phát hiện được.

---

## 4. MA TRẬN PHÂN TÍCH COMPLIANCE (Compliance Matrix)

| Yêu cầu Thiết kế (Gốc) | Trạng thái Thực tế | Mức độ Đáp ứng | Chi tiết Kỹ thuật & Gợi ý |
|---|---|---|---|
| **Split-screen Layout** | **DONE** | 100% | Tách đôi 45/55 sử dụng react-resizable-panels, kéo thả mượt. |
| **Rich Text Editor (Tiptap)** | **DONE** | 100% | Tích hợp StarterKit, Table, Highlight, Align, autosave 2s. |
| **Ingestion Worker (Docling)** | **DONE** | 100% | Sử dụng ProcessPoolExecutor với cơ chế warmup Singleton trên lifespan. |
| **Page Metadata Citation** | **DONE** | 100% | Lấy chính xác `item.prov[0].page_no` (1-indexed) để hiển thị trang. |
| **Isolated DB Partition** | **DONE** | 100% | Tạo bảng LanceDB động `workspace_{id}_chunks` và SQLite 8 bảng. |
| **SSE Streaming Protocol** | **DONE** | 90% | Trả về event status, citations, text, done, error đầy đủ qua endpoint. |
| **Real-time thought logs** | **DONE** | 100% | Khắc phục xong GAP-01 của Round 3. stream_mode="updates" chạy thực tế. |
| **Context budget (History)** | **DONE** | 100% | Ước lượng tokens và gọi `llm.summarize_history` tối ưu hóa prompt. |
| **Local Re-ranker** | **DONE** | 100% | Cosine rerank 100 -> 15 chunks, sửa xong bug conversion numpy array. |
| **Human-in-the-loop** | **PARTIAL** | 40% | Backend OK, Frontend nuốt sự kiện `ask_user`, thiếu UI handler. (GAP-01) |
| **Citation jump in Editor** | **PARTIAL** | 50% | Chat panel OK, Editor chèn raw text tĩnh `[1]` không click được. (GAP-02) |
| **Save Editor & load reports** | **DONE** | 80% | Đã kết nối API PUT/POST thật. Tuy nhiên lưu Markdown bị mất định dạng. (GAP-03) |
| **Security JWT & Auth** | **DONE** | 100% | Dialog Đăng nhập/Đăng ký đính kèm Token trong headers qua apiFetch. |

---

## 5. ĐÁNH GIÁ PHỔ ĐIỂM TIẾN TRÌNH

| Hạng mục đánh giá | Round 1 | Round 2 | Round 3 | Round 4 | Ghi chú vòng này |
|---|---|---|---|---|---|
| **Kiến trúc Backend** | 6.0 | 8.0 | 9.0 | **9.5/10** | Dual-server management, Ingestion Worker, và partition LanceDB tuyệt vời. |
| **Chất lượng Agentic RAG** | 3.0 | 7.0 | 8.0 | **8.5/10** | Planner, Reranker, và History Summarizer hoạt động chuẩn chỉ. |
| **Core Loop (Chat->Editor->Save)**| 1.0 | 4.0 | 9.0 | **9.0/10** | Dòng chảy dữ liệu trơn tru. GAP lưu markdown không ảnh hưởng demo UI. |
| **Trải nghiệm Frontend (UX)** | 5.0 | 7.0 | 8.5 | **8.5/10** | Layout chia đôi màn hình và PDF viewer đẹp. Cần thêm UI xóa và tương tác. |
| **Tuân thủ thiết kế Gốc** | 4.0 | 7.0 | 8.5 | **8.8/10** | Đạt độ khớp 90%. 10% còn lại là các tính năng tương tác sâu (interactive). |
| **TỔNG ĐIỂM** | **4.8/10** | **7.4/10** | **8.6/10** | **8.9/10** | **Đủ điều kiện ra mắt bản thử nghiệm Alpha.** |

---

## 6. KHUYẾN NGHỊ ĐỂ HOÀN THIỆN MVP (Actionable Recommendation)

Để thu hẹp hoàn toàn khoảng cách với tài liệu thiết kế gốc và đưa sản phẩm đạt chuẩn thương mại hóa (Production-Grade), cần thực hiện các hành động sau:

1. **Khắc phục GAP-01 (Human-in-the-loop):**
   - Trong `frontend/src/hooks/use-sse-chat.ts`, bổ sung callback `onAskUser` vào interface và xử lý parse sự kiện `ask_user`.
   - Trong `chat-panel.tsx`, khi nhận được callback `onAskUser`, render một hộp thoại cảnh báo mâu thuẫn số liệu (Discrepancy resolution popup/dialog) hiển thị các nguồn mâu thuẫn để người dùng click lựa chọn phương án giải quyết và gửi câu trả lời trở lại.

2. **Khắc phục GAP-02 (Interactive Citations in Editor):**
   - Trong `frontend/src/components/rich-editor.tsx`, viết lại helper `renderInlineMarkdown` để nhận biết mẫu `\[\d+\]` và tạo thẻ anchor `<a href="#" class="citation-link">` tương ứng.
   - Thêm bộ lắng nghe sự kiện click trên Editor. Khi click vào liên kết citation, phát ra sự kiện đính kèm thông tin trang và mã tệp để PDF Viewer bên trái tự động hiển thị và nhảy trang.

3. **Khắc phục GAP-03 (Format Markdown Save):**
   - Sử dụng một thư viện convert HTML -> Markdown phía Client (như `turndown` NPM package) hoặc tự viết một module parser HTML sang Markdown sạch sẽ thay vì dùng regex `htmlToPlainText` làm phẳng dữ liệu khi autosave.

4. **Khắc phục GAP-04 (UI Delete Buttons):**
   - Thêm biểu tượng Thùng rác (Trash icon) nhỏ bên cạnh mỗi Workspace trong danh sách Workspace và bên cạnh tên File nguồn trong danh sách tài liệu. Khi click, gửi tương ứng request `DELETE` đến API của backend để đồng bộ dọn dẹp ổ đĩa.
