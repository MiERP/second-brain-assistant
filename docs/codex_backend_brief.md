# Tài Liệu Bàn Giao Nhiệm Vụ Backend (Dành cho Codex - Bản Production Chuyên Sâu V2)

Chào Codex! Bạn là AI chuyên gia phát triển backend Python. Bạn đang đồng hành cùng Antigravity (Gemini - phụ trách Frontend, UI/UX, Testing và Code Review) để xây dựng ứng dụng **Second Brain Assistant** (Trợ lý Nghiên Cứu & Viết Báo Cáo cục bộ).

---

## ⚠️ ĐIỀU KHOẢN BẮT BUỘC KHI THỰC HIỆN (MUST-FOLLOW RULES)

1.  **LUÔN LUÔN SỬ DỤNG SKILLS**: Trước khi thực hiện bất kỳ tác vụ nào, bạn **BẮT BUỘC** phải gọi và tuân thủ các hướng dẫn của các skill tương ứng. Đặc biệt là các skill:
    *   `karpathy` (hoặc các skill định hướng lập trình từng bước cực kỳ chặt chẽ - Coder Mode/Builder): Luôn đọc hiểu mã nguồn hiện tại, chạy khảo sát, lập kế hoạch chi tiết, viết kiểm thử trước (TDD) và triển khai cuốn chiếu từ phần nhỏ nhất. Không viết code gộp hay nhảy cóc.
    *   `coder-mode`: Bạn phải đọc kỹ các tệp trong workspace trước khi viết bất kỳ dòng code nào.
    *   `backend-patterns`: Áp dụng cho thiết kế API FastAPI, phân tầng logic (Router -> Service -> Model).
    *   `database-migrations`: Sử dụng khi thiết kế schema SQLite và LanceDB.
    *   `python-testing`: Sử dụng khi viết bộ test cho backend.
    *   `verification-loop`: Dùng để xác minh mã nguồn trước khi hoàn thành phiên làm việc.
2.  **TIÊU CHÍ LOCAL-FIRST & DUAL-SERVER**: 
    *   Ứng dụng phải hoạt động offline hoàn toàn.
    *   Backend (hoặc tiến trình chính) phải tự động quản lý khởi chạy và giám sát **hai (2) tiến trình llama-server độc lập** lấy từ thư mục `llama-bin/` (ví dụ: copy từ `D:\PROJECT\Agentic-AI\MiChat\llama-bin`):
        *   **Chat Server (Port 8000)**: Chạy mô hình Gemma 4 GGUF cho hội thoại, planning và drafting.
        *   **Embedding Server (Port 8001)**: Chạy mô hình BGE/E5 GGUF với tham số `--embedding` cho việc sinh vector chunks.

---

## 1. Thiết Kế Cơ Sở Dữ Liệu & Hướng Dẫn Tích Hợp (Database & Resources Map)

Bạn cần thiết lập các database cục bộ theo tiêu chuẩn an toàn dữ liệu, hỗ trợ đồng thời cả dạng Web App (Multi-User) và Desktop App (Single-User):

### A. SQLite Metadata Schema (Sử dụng SQLAlchemy & Alembic)
Thiết lập database SQLite tại thư mục `storage/`. Viết các SQLAlchemy model và thiết lập **Alembic** để quản lý các migrations. Cấu trúc các bảng:
*   `users`: `id` (VARCHAR PK), `email` (VARCHAR Unique), `hashed_password` (VARCHAR), `role` (VARCHAR - *admin, user*), `created_at` (TIMESTAMP).
*   `workspaces`: `id` (VARCHAR PK), `name` (VARCHAR), `description` (TEXT), `owner_id` (VARCHAR FK -> users.id), `created_at` (TIMESTAMP).
*   `documents`: `id` (VARCHAR PK), `workspace_id` (VARCHAR FK -> workspaces.id), `filename` (VARCHAR), `filepath` (VARCHAR), `file_size` (INTEGER), `status` (VARCHAR - *pending, parsing, indexed, error*), `page_count` (INTEGER), `created_at` (TIMESTAMP).
*   `document_snapshots`: `id` (VARCHAR PK), `document_id` (VARCHAR FK -> documents.id), `version` (INTEGER), `content_markdown` (TEXT), `created_at` (TIMESTAMP).
*   `chat_conversations`: `id` (VARCHAR PK), `workspace_id` (VARCHAR FK -> workspaces.id), `title` (VARCHAR), `created_at` (TIMESTAMP).
*   `chat_messages`: `id` (VARCHAR PK), `conversation_id` (VARCHAR FK -> chat_conversations.id), `role` (VARCHAR - *user, assistant*), `content` (TEXT), `citations` (JSON - lưu trữ list metadata nguồn trích dẫn), `created_at` (TIMESTAMP).

### B. Phân Vùng LanceDB Vector Database
*   Tài liệu tham khảo cấu hình LanceDB: `resources/kotaemon-main/libs/kotaemon/kotaemon/storages/vector/lancedb.py`
*   Yêu cầu: Không được lưu chung tất cả workspace vào một bảng. Bạn phải thiết lập LanceDB client ghi file cục bộ vào thư mục `storage/lancedb/` và tự động tạo bảng động theo định dạng: `workspace_{workspace_id}_chunks`.
*   Cấu trúc của bảng vector chunks:
    *   `vector` (float32[]): Embeddings sinh từ llama.cpp `/v1/embeddings` (sử dụng model local `bge-large-en`).
    *   `id` (VARCHAR(36)): UUID4 định danh chunk.
    *   `document_id` (VARCHAR(36)): Khóa ngoại tham chiếu sang bảng `documents` bên SQLite.
    *   `text` (TEXT): Văn bản thô của chunk.
    *   `page_label` (INTEGER): Số trang trong file gốc (phục vụ hiển thị citation).
    *   `chunk_type` (VARCHAR(10)): Phân loại `"text"`, `"table"`, `"image"`.

---

## 2. Ingestor & Quản Lý Tiến Trình Llama-Server Nội Bộ

### 2.1. Quản lý tiến trình llama-server (Dual-Server)
Nghiên cứu cách triển khai LlamaService trong dự án `MiChat` tại `D:\PROJECT\Agentic-AI\MiChat\MiChat-1.1-know\Michat-michat-0.1.3\src\main\services\LlamaService.ts`.
Bạn cần triển khai module quản lý tiến trình bằng Python (sử dụng `subprocess.Popen`):
*   **Tự động nhận diện phần cứng (PowerShell/CIM query trên Windows)**: Truy vấn số nhân CPU vật lý, dung lượng RAM, GPU vendor (NVIDIA/AMD) và VRAM.
*   **Tính toán cấu hình chạy tối ưu**:
    *   Tính toán tham số luồng `--threads` bằng số nhân CPU vật lý thực tế.
    *   Tính toán tham số `--n-gpu-layers` dựa trên VRAM trống của GPU để đẩy tính toán tensor lên GPU tối đa mà không gây sập CUDA OOM.
*   **Khởi chạy Server**:
    *   *Chat Server*: Khởi chạy trên port 8000, model Gemma 4 GGUF, context size 32768, tắt reasoning (`--reasoning off`), bật `--flash-attn auto` và `--no-warmup`.
    *   *Embedding Server*: Khởi chạy trên port 8001, model BGE/E5 GGUF, context size 1024, bật `--embedding`, bật `--flash-attn auto` và `--no-warmup`.
*   **Giám sát & Tự động restart**: Lắng nghe logs (stderr), phát hiện sập tiến trình và tự động khởi chạy lại.

### 2.2. Ingestion Pipeline & Throttling
*   **Ngăn Chặn Path Traversal**: Viết hàm lọc tên tệp tin tải lên (chỉ giữ lại ký tự alphanumeric, dấu chấm, dấu gạch ngang, gạch dưới) và lưu tệp vào thư mục biệt lập nằm ngoài thư mục tài nguyên web tĩnh (ví dụ: `storage/documents/{workspace_id}/{file_id}.pdf`).
*   **Thống Nhất Ingestion Worker**:
    *   Tài liệu tham khảo Docling: `resources/kotaemon-main/libs/kotaemon/kotaemon/loaders/docling_loader.py`.
    *   Sử dụng `asyncio.Queue` để xếp hàng xử lý tài liệu tuần tự khi người dùng upload nhiều file.
    *   Sử dụng một Process Pool Worker (`ProcessPoolExecutor` với `max_workers=1` hoặc `max_workers=2`) để chạy Docling parser. Nếu tiến trình worker này bị crash (do tràn RAM/OOM), tiến trình API FastAPI chính vẫn phải hoạt động bình thường.
*   **Chiến Thuật Chunking**:
    *   Sử dụng `MarkdownHeaderTextSplitter` để chia nhỏ văn bản dựa trên cấu trúc các tiêu đề `#`, `##`, `###`. Giới hạn kích thước chunk tối đa là **500 từ (~1000 tokens)** với độ đè ký tự (overlap) là **100 từ**.
    *   Giữ nguyên toàn bộ chuỗi Markdown Table của một bảng biểu làm một chunk duy nhất, không được cắt nhỏ bảng dữ liệu.

---

## 3. Đặc Tả Agentic RAG Bằng LangGraph

Bạn cần triển khai đồ thị LangGraph (`backend/app/services/agent/`) tối ưu hóa riêng cho **Gemma 4** và kết nối qua **llama.cpp Server**:

*   **Context Budget Management**: Cấu hình ngữ cảnh tối đa của Gemma 4 là **32,768 tokens**. Thực hiện cắt tỉa lịch sử chat (kết hợp gọi LLM tóm tắt lịch sử hội thoại khi vượt quá 8,000 tokens). Sử dụng local re-ranker model để lọc từ 100 chunks thô xuống còn **15 chunks** có mức độ liên quan cao nhất trước khi đưa vào context prompt.
*   **Các Node Trong Đồ Thị**:
    1.  `Planner Node`: Lập kế hoạch, chia nhỏ câu hỏi lớn thành các câu hỏi nghiên cứu phụ (sub-queries).
    2.  `Retriever Node`: Truy vấn song song trên các bảng vector LanceDB tương ứng của workspace.
    3.  `Synthesizer Node`: Tổng hợp thông tin, so sánh và phát hiện mâu thuẫn số liệu chéo. Nếu phát hiện mâu thuẫn, chuyển đồ thị sang trạng thái `Ask User Node` (Human-in-the-loop) để tạm dừng luồng và chờ phản hồi từ người dùng qua API chat.
    4.  `Writer Node`: Tạo văn bản báo cáo Markdown kèm trích dẫn nguồn có cấu trúc `[n] (filename, trang_số)`.
    5.  `Self-Correction Node`: Tự động kiểm tra lỗi cú pháp và trích dẫn, yêu cầu mô hình sửa lại các đoạn bị lỗi.

---

## 4. Giao Thức API SSE Streaming (FastAPI)

API `/workspaces/{workspace_id}/chat` phải trả về luồng stream Server-Sent Events (SSE) tuân thủ đúng cấu trúc JSON sau:

*   **Báo cáo tiến trình**:
    `event: status\ndata: {"node": "planner", "message": "Đang phân tích và lập kế hoạch nghiên cứu..."}\n\n`
*   **Trả về Metadata Trích dẫn**:
    `event: citations\ndata: [{"id": 1, "document_id": "doc-uuid", "filename": "report.pdf", "page": 5, "snippet": "Tesla use 4680 battery cells..."}]\n\n`
*   **Stream text nội dung**:
    `event: text\ndata: {"delta": "Theo số liệu thu thập được..."}\n\n`
*   **Báo cáo hoàn thành**:
    `event: done\ndata: {"message": "Đã hoàn thành soạn thảo báo cáo."}\n\n`

---

## 5. Hướng Dẫn Bắt Đầu
Hãy bắt đầu bằng việc thiết lập môi trường, viết `requirements.txt` và khởi dựng bộ khung FastAPI (`main.py`, `config.py` và `database.py`). Hãy báo cáo tiến độ và mã nguồn cho người dùng để Antigravity có thể tiến hành code review và tích hợp Frontend tương ứng. Hãy nhớ gọi và tuân thủ các skill của bạn trước khi viết code!

---

## 6. Góp Ý & Phản Biện Chi Tiết Từ Code Review (Đợt Đánh Giá 06/06/2026)

Qua đợt đánh giá mã nguồn backend hiện tại của Codex, Antigravity phát hiện các lỗ hổng/functional gaps nghiêm trọng cần giải quyết để đạt chuẩn **Production-Grade**:

### 6.1. Bắt buộc tích hợp LangGraph thực tế (Chưa sử dụng)
*   *Vấn đề*: Lớp `ResearchAgent` trong `app/services/agent.py` hiện tại là một luồng gọi hàm tuyến tính thô sơ (Linear RAG), không hề import hay sử dụng `langgraph` dù đã cài đặt thư viện. Hàm `_plan` và `_needs_user_clarification` đang dùng regex rất dễ lỗi thay vì gọi mô hình suy luận.
*   *Yêu cầu*: Chuyển đổi toàn bộ lớp `ResearchAgent` sang cấu trúc `StateGraph` của LangGraph. Viết các Node rõ ràng (`planner`, `retriever`, `discrepancy_checker`, `writer`), và sử dụng conditional edge để phân loại luồng chạy.

### 6.2. Thu thập chính xác số trang từ Docling (Mất metadata trang)
*   *Vấn đề*: Hàm `parse_document_file` trong `app/services/parser.py` đang gộp toàn bộ nội dung parse được vào một `ParsedSection` duy nhất trên `page_label=1`. Điều này làm tất cả trích dẫn RAG hiển thị sai (luôn hiển thị Trang 1), khiến frontend không vẽ được highlight trên PDF Viewer.
*   *Yêu cầu*: Duyệt qua từng phần tử bằng `document.iterate_items()` trong Docling, lấy đúng số trang gốc `item.prov[0].page_no` (1-indexed) để tạo các `ParsedSection` tương ứng với số trang thực tế.

### 6.3. Khắc phục bottleneck tải lại mô hình Docling (ProcessPool weights reload)
*   *Vấn đề*: Việc instantiate `DocumentConverter()` trong mỗi worker con của `ProcessPoolExecutor` khiến mô hình PyTorch phải load lại từ đĩa cứng vào bộ nhớ RAM mỗi lần tải lên một tài liệu (mất 5 - 10 giây).
*   *Yêu cầu*: Khởi tạo `DocumentConverter` dưới dạng một Singleton giữ ấm (warm-up) một lần duy nhất tại startup (FastAPI lifespan) và tái sử dụng nó.

### 6.4. Bổ sung cô lập Workspace & Xác thực (Broken Access Control)
*   *Vấn đề*: SQLite có bảng `User` nhưng router `workspaces.py` lại trả về toàn bộ workspaces trong hệ thống cho bất kỳ ai gọi API (`db.scalars(select(Workspace))`). Chưa có JWT authentication middleware để bảo vệ các API.
*   *Yêu cầu*: Thêm router đăng nhập/đăng ký, cấp JWT token, viết dependency xác thực token và lọc toàn bộ dữ liệu workspace theo `owner_id` (trừ chế độ Desktop App tự động bypass bằng local user).

### 6.5. Cấu hình cục bộ cho Llama.cpp Server
*   *Vấn đề*: Đường dẫn mặc định đến `D:\PROJECT\Agentic-AI\MiChat\llama-bin` chưa được cấu hình fallback, khiến LlamaProcessManager không khởi chạy được tiến trình llama-server.exe.
*   *Yêu cầu*: Bổ sung biến môi trường `LLAMA_AUTO_ROOT` trong `.env` của backend chỉ định đường dẫn trên, và thêm cơ chế tự động tìm kiếm.
