# Báo Cáo Đánh Giá & Phản Biện Codebase Cấp Độ Production-Ready

> **Ngày đánh giá:** 06/06/2026 | **Reviewer:** Antigravity (AI Architect)
> **Dự án:** Second Brain Assistant
> **Mục tiêu:** Đánh giá độ ổn định, hiệu năng, bảo mật, và khả năng scale của codebase hiện tại khi chuyển dịch từ môi trường Single-user Local (Desktop App) sang hệ thống Multi-user Production-grade (Web App).

---

## 1. KIẾN TRÚC LLM & DUAL-SERVER (Process Management)

### Vấn đề 01: Xung đột cổng & GPU OOM khi chạy Multi-worker (FastAPI)
*   **Thực tế:** Trong `main.py`, class `LlamaProcessManager` quản lý việc khởi chạy các tiến trình `llama-server` bằng `subprocess.Popen` thông qua FastAPI `lifespan`.
*   **Rủi ro Production:**
    *   Khi triển khai ứng dụng FastAPI thực tế trên môi trường production, chúng ta thường dùng uvicorn/gunicorn chạy với nhiều worker (ví dụ: `--workers 4` hoặc `N` worker ứng với số core CPU).
    *   Mỗi worker là một hệ điều hành process độc lập. Khi FastAPI start, **mỗi worker sẽ cố gắng khởi chạy 2 tiến trình llama-server riêng biệt** (Chat Server & Embedding Server).
    *   Điều này dẫn đến Port Collision (Port 8000 và 8001 đã bị chiếm bởi worker đầu tiên, các worker sau sẽ lỗi khởi chạy), gây ra vòng lặp crash và restart tiến trình liên tục, làm nghẽn CPU/GPU và gây sập CUDA OOM (Out Of Memory) ngay lập tức.
*   **Giải pháp:**
    *   **Bắt buộc tách biệt:** Gỡ bỏ hoàn toàn việc quản lý tiến trình AI khỏi FastAPI Lifecycle.
    *   Mô hình AI phải được triển khai như các dịch vụ microservices độc lập (ví dụ: chạy Ollama độc lập, dùng Docker Compose, hoặc trỏ trực tiếp đến các cụm server chuyên dụng như vLLM, Triton).

---

## 2. LƯU TRỮ DỮ LIỆU & ĐỒNG BỘ CONCURRENCY (Database Layer)

### Vấn đề 02: Lỗi SQLite Locks khi ghi đồng thời (Concurrency Write Collisions)
*   **Thực tế:** Dự án đang sử dụng **SQLite** (`metadata.db`) làm cơ sở dữ liệu lưu trữ metadata chính cho người dùng, workspaces, reports, snapshots, và lịch sử chat.
*   **Rủi ro Production:**
    *   SQLite là một DB dạng file đơn giản và có cơ chế khóa toàn bộ database khi ghi (database-level locking).
    *   Khi chạy ở môi trường nhiều người dùng (Multi-user), nếu có nhiều người cùng chat hoặc hệ thống thực hiện autosave liên tục (Editor autosave mỗi 2 giây) cộng thêm nhiều tệp PDF đang được ingest và đổi trạng thái (`pending -> parsing -> indexed`), SQLite sẽ lập tức trả về lỗi:
        `sqlite3.OperationalError: database is locked`
    *   FastAPI sẽ trả về lỗi HTTP 500 cho người dùng và các luồng ghi dữ liệu/snapshots báo cáo sẽ bị hỏng.
*   **Giải pháp:**
    *   Cấu hình cơ chế nạp biến môi trường cho phép chuyển đổi Engine kết nối cơ sở dữ liệu sang các DBMS client-server thực sự như **PostgreSQL** ở môi trường Production, giữ SQLite làm cấu hình chạy local dev/desktop app.

---

## 3. CHẤT LƯỢNG RETRIEVAL & VECTOR SEARCH (Semantic Integrity)

### Vấn đề 03: Độc hóa cơ sở dữ liệu vector do cơ chế Fallback Embedding tĩnh (SHA-256 Mock)
*   **Thực tế:** Trong `embeddings.py`, khi kết nối đến Embedding Server bị lỗi hoặc timeout, hệ thống sẽ tự động chuyển đổi sang cơ chế fallback tạo vector mô phỏng bằng hàm băm SHA-256 (`_fallback_embedding`).
*   **Rủi ro Production:**
    *   Đây là một "silent hazard" cực kỳ nguy hiểm. Khi Embedding Server gặp sự cố mạng tạm thời hoặc quá tải, các tệp PDF được upload lên vẫn được parse bình thường nhưng các chunk văn bản sẽ được gán vector giả lập bằng SHA-256.
    *   Vì hàm băm SHA-256 không phản ánh bất kỳ mối quan hệ ngữ nghĩa nào (semantic meaning), các vector này sẽ bị phân tán hỗn loạn trong không gian vector.
    *   Khi người dùng tìm kiếm, thuật toán Cosine Similarity sẽ cho ra kết quả hoàn toàn vô nghĩa hoặc không bao giờ khớp với các đoạn văn bản này. Cơ sở dữ liệu sẽ bị "nhiễm độc" dữ liệu rác mà không hề có cảnh báo lỗi hệ thống nào được đưa ra.
*   **Giải pháp:**
    *   **Fail-Fast Principle:** Tuyệt đối không sử dụng Mock Embedding cho môi trường production.
    *   Khi dịch vụ embedding bị lỗi, hệ thống phải ném ra lỗi `HTTP 503 Service Unavailable` và chuyển trạng thái tài liệu sang `error` kèm chi tiết log. Hoặc đưa tác vụ tạo embedding vào một hàng đợi (Queue) có cơ chế Retry với số mũ lùi (exponential backoff).

---

## 4. BẢO MẬT & ĐỘ ỔN ĐỊNH CỦA ĐƯỜNG TRUYỀN (Networking & API)

### Vấn đề 04: Nghẽn và đứt kết nối stream SSE do Buffering của Reverse Proxy
*   **Thực tế:** Hàm chat API `/workspaces/{workspace_id}/chat` trả về luồng `StreamingResponse` với media type `text/event-stream`.
*   **Rủi ro Production:**
    *   Khi deploy sản phẩm thực tế, ứng dụng FastAPI thường được đặt phía sau các Reverse Proxy như **Nginx**, **Apache**, hoặc qua tường lửa **Cloudflare**.
    *   Theo mặc định, Nginx thực hiện nén và đệm phản hồi (Response Buffering). Nó sẽ chờ thu thập đủ buffer (thường là 4KB hoặc 16KB) trước khi đẩy dữ liệu xuống Client.
    *   Điều này triệt tiêu hoàn toàn tính năng Streaming thực tế của LLM. Người dùng sẽ thấy chat bị đơ ra khoảng 10 - 20 giây rồi câu trả lời dài đột ngột xuất hiện cùng lúc, tạo cảm giác giật lag nghiêm trọng.
*   **Giải pháp:**
    *   Trong FastAPI router, cần định nghĩa rõ ràng các Response Headers để tắt đệm và giữ kết nối:
        ```python
        headers = {
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Tắt buffering của Nginx
        }
        return StreamingResponse(event_stream(), media_type="text/event-stream", headers=headers)
        ```

---

## 5. QUẢN LÝ TÀI NGUYÊN HỆ THỐNG & ĐỘC LẬP TÁC VỤ (Resource Management)

### Vấn đề 05: Đơ/Chết luồng xử lý do nghẽn tài nguyên Ingestor
*   **Thực tế:** Hệ thống sử dụng `ProcessPoolExecutor` chạy trực tiếp trên FastAPI Process để thực hiện Docling parser.
*   **Rủi ro Production:**
    *   Docling là một thư viện rất nặng (sử dụng PyTorch và các mô hình thị giác máy tính để phân tích cấu trúc PDF). Mỗi tiến trình chuyển đổi file PDF có thể ngốn từ 2GB đến 4GB RAM.
    *   Nếu nhiều người dùng đồng thời tải lên nhiều file PDF lớn (ví dụ 100 trang), `ProcessPoolExecutor` chạy chung trên RAM của FastAPI main process sẽ dễ dàng kích hoạt cơ chế Out-Of-Memory (OOM) killer của hệ điều hành.
    *   Khi hệ điều hành kill tiến trình worker vì tràn RAM, FastAPI main process sẽ nhận lỗi `BrokenProcessPool`. Sau thời điểm đó, toàn bộ yêu cầu tải file và phân tích tài liệu sau đó của mọi người dùng sẽ bị đơ hoặc lỗi hoàn toàn cho đến khi restart backend.
*   **Giải pháp:**
    *   **Distributed Task Queue:** Sử dụng các hàng đợi tác vụ độc lập như **Celery** với **Redis** hoặc **RabbitMQ** để phân tách hoàn toàn tài nguyên CPU/RAM của tác vụ Ingestion (Docling) ra một cụm worker vật lý riêng biệt.

---

## 6. XỬ LÝ LỖI & PHỤC HỒI GIAO DỊCH (Database Transaction Safety)

### Vấn đề 06: Thiếu Rollback khi lỗi ghi cơ sở dữ liệu
*   **Thực tế:** Hầu hết các API ghi dữ liệu trong `workspaces.py` (ví dụ: tạo report, upload document) đều gọi `db.commit()` mà không sử dụng cấu trúc `try-except-rollback` bảo vệ.
*   **Rủi ro Production:**
    *   Nếu quá trình thêm bản ghi cha thành công (`db.add(report)`) nhưng bản ghi snapshot con bị lỗi ghi do lỗi validate, DB session sẽ không được rollback.
    *   Điều này dẫn đến tình trạng "lửng lơ" (dirty session), các truy vấn sau đó trên luồng này sẽ lỗi và dữ liệu rác mồ côi (orphaned data) sẽ tồn tại trong cơ sở dữ liệu.
*   **Giải pháp:**
    *   Sử dụng context manager để quản lý transaction hoặc viết tường minh:
        ```python
        try:
            db.add(item)
            db.commit()
        except Exception:
            db.rollback()
            raise
        ```

---

## 7. BẢNG TỔNG HỢP KIỂM TRA ĐỘ SẴN SÀNG PRODUCTION (Production Checklist)

| Thành phần | Tiêu chí đánh giá | Trạng thái hiện tại | Đánh giá Production | Đề xuất giải pháp |
|---|---|---|---|---|
| **Cấu hình** | Bảo mật API Key & Secrets | Lưu trữ trong `.env` | **OK** | Đảm bảo chuyển sang AWS Secrets Manager / Vault khi scale. |
| **Quy trình AI** | Quản lý tiến trình Llama | Tự động spawn bằng Python | **BAD** | Tách hẳn sang dịch vụ Container riêng (Docker/K8s). |
| **Độ tin cậy RAG** | Embedding Fallback | SHA-256 Dummy Vector | **DANGEROUS** | Loại bỏ fallback băm, ném lỗi 503 để Client thực hiện Retry. |
| **Giao diện API** | SSE Stream Buffering | Không định nghĩa headers bypass | **BAD** | Thêm headers `X-Accel-Buffering: no` và `Cache-Control`. |
| **Cơ sở dữ liệu** | Xử lý Concurrency | SQLite đơn luồng ghi | **BAD** | Chuyển đổi sang PostgreSQL / Supabase DB. |
| **Tác vụ nền** | Quản lý Ingestion RAM | ProcessPool trên main server | **WARN** | Chuyển sang Celery + Redis Task Queue. |
| **An toàn luồng** | Transaction Integrity | Thiếu try-rollback trong API | **WARN** | Wrap các tác vụ ghi DB trong block try-except rollback. |
