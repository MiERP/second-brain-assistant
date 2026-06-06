# Kế Hoạch Triển Khai: Second Brain Assistant (Trợ lý Nghiên Cứu & Viết Báo Cáo)

Tài liệu này mô tả chi tiết thiết kế hệ thống, kiến trúc phần mềm, cấu trúc thư mục và lộ trình phát triển từng bước cho dự án **Second Brain Assistant**. Dự án được thiết kế dựa trên các thảo luận và tài liệu định hướng trong `ideas-second-brain.md`.

---

## 1. Tổng Quan Kiến Trúc Hệ Thống (Architecture Overview)

Hệ thống được thiết kế theo mô hình **Agentic RAG** (RAG định hướng tác vụ), phân tách rõ ràng giữa giao diện tương tác (Frontend) và bộ não xử lý (Backend):

```
┌────────────────────────────────────────────────────────┐
│ FRONTEND (Next.js 15 + Tailwind CSS + Shadcn/ui)       │
│ - Màn hình chia đôi (Split-screen)                     │
│ - Cột trái: Chat & Quản lý Workspace tài liệu          │
│ - Cột phải: Rich Text Editor (Tiptap) viết báo cáo     │
└───────────────────────────┬────────────────────────────┘
                            │ (REST API & Server-Sent Events)
                            ▼
┌────────────────────────────────────────────────────────┐
│ BACKEND (FastAPI - Python)                             │
│ - Router & Controllers (Quản lý API endpoints)         │
│ - Document Ingestor (Docling)                          │
│ - Agent Orchestrator (LangGraph - State Machine RAG)   │
└───────────────────────────┬────────────────────────────┘
                            │ (Local DB Connection)
                            ▼
┌────────────────────────────────────────────────────────┐
│ STORAGE LAYER                                          │
│ - Vector Database: LanceDB (Local, Serverless)         │
│ - Metadata Database: SQLite (Lưu thông tin Workspace)   │
└────────────────────────────────────────────────────────┘
```

---

## 2. Thiết Kế Chi Tiết Các Hợp Phần (Component Design)

### 2.1 Backend (Python FastAPI)
Lý do chọn Python: Hệ sinh thái thư viện xử lý tài liệu (Docling) và xây dựng Agent (LangGraph/LlamaIndex) tối ưu nhất hiện nay.

#### Cấu Trúc Thư Mục Backend Đề Xuất:
```
backend/
├── app/
│   ├── __init__.py
│   ├── config.py          # Quản lý cấu hình & API keys
│   ├── main.py            # Khởi chạy FastAPI app
│   ├── database.py        # Kết nối SQLite & LanceDB
│   ├── models/            # Pydantic schemas & DB models
│   │   ├── workspace.py
│   │   └── document.py
│   ├── routers/           # Các endpoints API
│   │   ├── workspaces.py
│   │   ├── documents.py
│   │   └── chat.py
│   └── services/          # Logic xử lý chính
│       ├── ingestor.py    # Phân tích file (Docling)
│       └── agent/         # Định nghĩa Agentic Workflow (LangGraph)
│           ├── state.py   # Trạng thái của Agent
│           ├── graph.py   # Bản đồ các bước chạy Agent
│           └── nodes.py   # Logic từng bước (Planner, Retriever, Writer)
├── storage/               # Thư mục lưu trữ local (sqlite & lancedb tables)
├── requirements.txt
└── .env
```

#### Chi Tiết Luồng Agentic RAG (LangGraph):
*   **Planner Node:** Nhận yêu cầu của người dùng, phân tích xem cần thông tin từ những tài liệu nào trong workspace hiện tại. Tạo ra kế hoạch gồm các câu hỏi nhỏ cần nghiên cứu.
*   **Retriever Node:** Chạy các truy vấn tìm kiếm song song (Vector search trên LanceDB) để lấy ra các đoạn văn bản (chunks) liên quan nhất.
*   **Synthesizer Node:** Tổng hợp thông tin từ nhiều nguồn, so sánh sự khác biệt và giải quyết mâu thuẫn dữ liệu (nếu có).
*   **Drafting Node:** Soạn thảo báo cáo có kèm mã trích dẫn nguồn dạng `[1] (Tên_file.pdf, Trang X)`.

---

### 2.2 Frontend (Next.js 15)
Lý do chọn Next.js 15: Cung cấp Server Components tối ưu và kiến trúc thư mục `app/` hiện đại, dễ tích hợp với Tailwind CSS cho giao diện chia đôi màn hình (Split-screen) có độ phản hồi cao.

#### Cấu Trúc Thư Mục Frontend Đề Xuất:
```
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx             # Trang chính (Split-screen container)
│   │   └── globals.css
│   ├── components/              # Các UI Component tái sử dụng
│   │   ├── workspace-sidebar.tsx # Sidebar quản lý file & workspace
│   │   ├── chat-panel.tsx       # Khung chat bên trái
│   │   ├── document-viewer.tsx  # Cửa sổ xem thử tài liệu nguồn
│   │   └── rich-editor.tsx      # Trình soạn thảo văn bản Tiptap bên phải
│   ├── hooks/                   # Các custom React hooks
│   │   └── use-socket-sse.ts    # Nhận phản hồi stream từ backend
│   └── lib/
│       └── utils.ts             # Tailwind class merger
├── package.json
└── tailwind.config.ts
```

#### Thiết Kế Giao Diện Tương Tác:
1.  **Giao diện Chia đôi (Split-screen Layout):** Sử dụng CSS Grid/Flexbox của Tailwind với thuộc tính `h-screen overflow-hidden` để tạo giao diện lấp đầy màn hình không bị cuộn trang ngoài, chia thành 2 bảng điều khiển chính:
    *   **Bên trái (45% chiều rộng):** Chat Panel để thảo luận với Trợ lý AI, tải lên tài liệu, hiển thị danh sách nguồn trích dẫn.
    *   **Bên phải (55% chiều rộng):** Rich Text Editor dựa trên **Tiptap** để người dùng viết và hoàn thiện báo cáo.
2.  **Đồng bộ Tương Tác (Interactive Sync):** 
    *   Khi AI hoàn thành dàn ý hoặc đoạn báo cáo ở khung chat bên trái, sẽ có một nút bấm nhanh: **"Đẩy sang Editor"** để tự động chèn nội dung vào vị trí con trỏ chuột bên trình soạn thảo phải.
    *   Tính năng trích dẫn (Citations) dạng hyperlink: Click vào số trích dẫn `[1]` trong bài viết sẽ tự động mở xem thử tài liệu nguồn bên trái và nhảy đến phân đoạn gốc.

---

### 2.3 Storage & Database Layer

*   **Metadata DB (SQLite):** Lưu trữ thông tin về Workspace (id, name, description), danh sách File đã upload (id, filename, filepath, status), và lịch sử các cuộc hội thoại.
*   **Vector DB (LanceDB):** Lưu trữ embeddings văn bản. LanceDB chạy local không cần cài docker server riêng, cho phép chúng ta chia bảng theo cấu trúc: `workspace_{workspace_id}_embeddings` giúp cô lập tuyệt đối dữ liệu giữa các workspace.

---

## 3. Kế Hoạch Triển Khai Từng Bước (Milestones)

### Giai Đoạn 1: Thiết Lập Nền Tảng (Móng dự án)
*   **Backend:**
    1.  Cài đặt môi trường Python ảo (`venv`).
    2.  Triển khai API FastAPI cơ bản với đầy đủ Swagger docs tại `/docs`.
    3.  Tạo kết nối database SQLite lưu thông tin Workspace và Document.
*   **Frontend:**
    1.  Khởi tạo dự án Next.js 15, tích hợp Tailwind CSS và shadcn/ui.
    2.  Xây dựng layout Split-screen thô chưa có logic AI.
    3.  Tích hợp Tiptap Editor cơ bản vào cột bên phải.

### Giai Đoạn 2: Xử Lý Tài Liệu & RAG Cơ Bản
*   **Backend:**
    1.  Viết API upload file tài liệu.
    2.  Tích hợp **Docling** để parse text từ file PDF/Word, thực hiện chunking thông minh giữ nguyên định dạng bảng biểu.
    3.  Khởi tạo local **LanceDB**, sinh embeddings cho tài liệu và lưu trữ.
    4.  Viết luồng RAG cơ bản: Tìm chunks liên quan -> Gửi LLM -> Trả lời câu hỏi đơn lẻ.
*   **Frontend:**
    1.  Hoàn thiện giao diện Sidebar để upload và quản lý file trong từng Workspace.
    2.  Hoàn thiện chat panel kết nối API chat RAG.

### Giai Đoạn 3: Tích Hợp Agentic Workflow (LangGraph)
*   **Backend:**
    1.  Thiết lập đồ thị Agentic bằng **LangGraph**.
    2.  Cài đặt node Planner để phân rã câu hỏi lớn thành các sub-queries.
    3.  Triển khai node Researcher để tìm kiếm thông tin song song trên nhiều file.
    4.  Định dạng dữ liệu trả về kèm thông tin trích dẫn chi tiết (Filename, Số trang).
*   **Frontend:**
    1.  Cập nhật Chat UI để hiển thị trạng thái suy nghĩ của Agent (ví dụ: *AI đang phân tích câu hỏi...*, *AI đang tìm trong file A.pdf...*).
    2.  Hiển thị thẻ trích dẫn (Citations) đẹp mắt, click vào tự động cuộn đến phần tài liệu liên quan.

### Giai Đoạn 4: Hoàn Thiện Tương Tác Split-screen & Đánh Giá
*   **Frontend & Backend:**
    1.  Xây dựng tính năng đồng bộ: Người dùng bôi đen đoạn văn bên editor để yêu cầu AI chỉnh sửa trực tiếp, hoặc nhấn nút chèn đoạn nháp AI vừa viết vào Editor.
    2.  Kiểm thử hiệu năng đọc và trích xuất dữ liệu, tối ưu hóa tốc độ sinh nội dung (Streaming API).

---

## 4. Kế Hoạch Xác Minh (Verification Plan)

*   **Xác minh Backend:** Kiểm tra các API endpoint bằng Swagger UI (`http://localhost:8000/docs`). Đảm bảo file tải lên được lưu đúng vị trí và sinh đủ vector trong LanceDB.
*   **Xác minh Luồng Agent:** Gửi câu hỏi phức tạp yêu cầu so sánh (như ví dụ về pin Tesla vs BYD) và kiểm tra logs xem Agent có thực sự chia nhỏ câu hỏi và truy vấn song song hay không.
*   **Xác minh Giao Diện:** Kiểm tra khả năng gõ chữ của Editor khi AI đang stream câu trả lời bên trái, đảm bảo không có hiện tượng giật lag (UI blocking).
