import os
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="Second Brain Assistant API",
    description="API cho trợ lý viết báo cáo và RAG đa tài liệu cục bộ",
    version="1.0.0"
)

# Cấu hình CORS cho phép frontend kết nối
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Trong thực tế nên giới hạn domain cụ thể
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str
    workspace_id: str
    chat_history: Optional[List[dict]] = []

class WorkspaceCreate(BaseModel):
    name: str
    description: Optional[str] = None

@app.get("/")
def read_root():
    return {
        "status": "online",
        "message": "Chào mừng đến với API Trợ lý Bộ não Thứ hai (Second Brain Assistant)",
        "version": "1.0.0"
    }

# Endpoint quản lý Workspace
@app.get("/workspaces")
def get_workspaces():
    # Stub: Trả về danh sách workspace hiện tại
    return [
        {"id": "default", "name": "Mặc định", "description": "Workspace chính"},
        {"id": "finance", "name": "Tài chính", "description": "Tài liệu và báo cáo tài chính"}
    ]

@app.post("/workspaces")
def create_workspace(workspace: WorkspaceCreate):
    # Stub: Tạo workspace mới
    return {
        "status": "success",
        "message": f"Đã tạo workspace '{workspace.name}'",
        "data": {
            "id": workspace.name.lower().replace(" ", "-"),
            "name": workspace.name,
            "description": workspace.description
        }
    }

# Endpoint upload tài liệu
@app.post("/workspaces/{workspace_id}/upload")
async def upload_document(workspace_id: str, file: UploadFile = File(...)):
    # Xác thực định dạng file
    allowed_extensions = [".pdf", ".txt", ".docx", ".md"]
    _, ext = os.path.splitext(file.filename)
    if ext.lower() not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Định dạng file không được hỗ trợ. Chỉ cho phép {', '.join(allowed_extensions)}"
        )
    
    # Stub: Lưu file và trigger ingestion pipeline
    # Sau này sẽ gọi Docling để parse và lưu vào LanceDB
    return {
        "status": "success",
        "message": f"Đã nhận file '{file.filename}' để xử lý trong workspace '{workspace_id}'",
        "filename": file.filename,
        "size_bytes": file.size
    }

# Endpoint chat với Agent (RAG)
@app.post("/workspaces/{workspace_id}/chat")
async def chat_with_agent(workspace_id: str, request: ChatRequest):
    # Stub: Phản hồi giả lập từ Agent
    # Sau này sẽ tích hợp LangGraph workflow
    user_message = request.message
    
    # Giả lập trích dẫn nguồn (citations)
    mock_citations = [
        {
            "id": 1,
            "filename": "tesla_battery_report.pdf",
            "page": 12,
            "text": "Tesla 4680 cells show a 16% increase in range due to form factor optimization."
        }
    ]
    
    agent_response = (
        f"Tôi đã nhận được câu hỏi của bạn về: '{user_message}'. "
        "Dựa trên các tài liệu trong workspace này, tôi xin tổng hợp như sau:\n\n"
        "1. Theo tài liệu của Tesla [1], công nghệ pin của họ tập trung vào tối ưu hóa cell pin 4680.\n"
        "2. Về phía BYD, họ sử dụng công nghệ pin Blade LFP với độ an toàn cao hơn.\n\n"
        "Bạn có muốn tôi bắt đầu lập dàn ý báo cáo so sánh chi tiết cho hai công nghệ này không?"
    )
    
    return {
        "response": agent_response,
        "citations": mock_citations
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
