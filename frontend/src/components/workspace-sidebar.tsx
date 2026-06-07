"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Folder, Plus, FileText, Upload, RefreshCw, Layers } from "lucide-react";
import { API_BASE, apiFetch } from "@/lib/api";
import { Workspace, Document } from "@/lib/types";
import { useToast } from "@/lib/toast";

interface WorkspaceSidebarProps {
  activeWorkspaceId: string;
  setActiveWorkspaceId: (id: string) => void;
  onSelectFile: (file: { id: string; filename: string }) => void;
}

export default function WorkspaceSidebar({
  activeWorkspaceId,
  setActiveWorkspaceId,
  onSelectFile,
}: WorkspaceSidebarProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Fetch workspaces - wrapped in useCallback
  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/workspaces`);
      if (res.ok) {
        const data: Workspace[] = await res.json();
        setWorkspaces(data);
        if (data.length > 0 && !activeWorkspaceId) {
          // Defer state updates to avoid synchronous rendering inside effects
          setTimeout(() => {
            setActiveWorkspaceId(data[0].id);
          }, 0);
        }
      } else {
        toast("Không thể tải danh sách không gian làm việc từ máy chủ.", "error");
      }
    } catch (err) {
      console.error("Failed to fetch workspaces", err);
      toast("Lỗi kết nối máy chủ khi tải không gian làm việc.", "error");
    }
  }, [activeWorkspaceId, setActiveWorkspaceId, toast]);

  // Fetch documents for active workspace - wrapped in useCallback
  const fetchDocuments = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setIsLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/workspaces/${activeWorkspaceId}/documents`);
      if (res.ok) {
        const data: Document[] = await res.json();
        setDocuments(data);
      } else {
        toast("Không thể tải danh sách tài liệu từ không gian làm việc.", "error");
      }
    } catch (err) {
      console.error("Failed to fetch documents", err);
      toast("Lỗi kết nối máy chủ khi tải tài liệu.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [activeWorkspaceId, toast]);

  // Load workspaces on mount
  useEffect(() => {
    const loadData = async () => {
      await fetchWorkspaces();
    };
    loadData();
  }, [fetchWorkspaces]);

  // Load documents when activeWorkspaceId changes
  useEffect(() => {
    const loadDocs = async () => {
      await fetchDocuments();
    };
    loadDocs();
  }, [activeWorkspaceId, fetchDocuments]);

  // Poll for document processing status if any document is parsing/pending
  useEffect(() => {
    const needsPolling = documents.some(
      (doc) => doc.status === "parsing" || doc.status === "pending"
    );
    if (!needsPolling) return;

    const interval = setInterval(() => {
      fetchDocuments();
    }, 3000);

    return () => clearInterval(interval);
  }, [documents, fetchDocuments]);

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;
    try {
      const res = await apiFetch(`${API_BASE}/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newWorkspaceName }),
      });
      if (res.ok) {
        const newWs: Workspace = await res.json();
        setWorkspaces((prev) => [...prev, newWs]);
        setActiveWorkspaceId(newWs.id);
        setNewWorkspaceName("");
        setIsCreatingWorkspace(false);
        toast(`Đã tạo không gian làm việc "${newWs.name}" thành công!`, "success");
      } else {
        toast("Yêu cầu tạo không gian làm việc thất bại.", "error");
      }
    } catch (err) {
      console.error("Failed to create workspace", err);
      toast("Gặp lỗi khi gửi yêu cầu tạo không gian làm việc.", "error");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0 || !activeWorkspaceId) return;
    setIsUploading(true);

    const formData = new FormData();
    formData.append("file", fileList[0]);

    toast("Đang bắt đầu tải tệp lên...", "info");
    try {
      const res = await apiFetch(`${API_BASE}/workspaces/${activeWorkspaceId}/upload`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const uploadedDoc: Document = await res.json();
        setDocuments((prev) => [uploadedDoc, ...prev]);
        toast(`Tải lên "${uploadedDoc.filename}" thành công! Đang tiến hành phân tích cú pháp...`, "success");
        // Trigger refetch
        fetchDocuments();
      } else {
        toast("Tải tệp lên thất bại. Định dạng không được hỗ trợ hoặc tệp quá lớn.", "error");
      }
    } catch (err) {
      console.error("Upload failed", err);
      toast("Lỗi kết nối máy chủ khi tải tệp lên.", "error");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-muted/30 border-r border-border w-64 select-none">
      {/* Brand Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Layers className="h-5 w-5 text-primary" />
        <span className="font-semibold text-sm tracking-tight">Second Brain</span>
      </div>

      {/* Workspace Selector */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Không gian làm việc
          </span>
          <button
            onClick={() => setIsCreatingWorkspace(!isCreatingWorkspace)}
            className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {isCreatingWorkspace ? (
          <form onSubmit={handleCreateWorkspace} className="flex flex-col gap-2 mb-2">
            <input
              type="text"
              placeholder="Tên workspace..."
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              className="px-2 py-1 text-xs border border-border rounded bg-background focus:outline-none focus:border-primary w-full"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setIsCreatingWorkspace(false)}
                className="px-2 py-1 text-[10px] rounded hover:bg-muted text-muted-foreground cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="px-2 py-1 text-[10px] rounded bg-primary text-primary-foreground font-semibold cursor-pointer"
              >
                Tạo
              </button>
            </div>
          </form>
        ) : null}

        <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => setActiveWorkspaceId(ws.id)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors font-medium cursor-pointer ${
                activeWorkspaceId === ws.id
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Folder className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{ws.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Document Manager */}
      <div className="flex-1 flex flex-col p-4 overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Tài liệu nguồn
          </span>
          <button
            onClick={fetchDocuments}
            className="p-1 hover:bg-muted rounded text-muted-foreground transition-colors cursor-pointer"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Upload area */}
        <label className="flex flex-col items-center justify-center border border-dashed border-border rounded-lg p-4 mb-4 hover:border-primary/50 cursor-pointer transition-colors bg-background/50 hover:bg-background">
          <Upload className={`h-5 w-5 text-muted-foreground mb-1 ${isUploading ? "animate-bounce" : ""}`} />
          <span className="text-[10px] text-muted-foreground text-center">
            {isUploading ? "Đang tải lên..." : "Kéo thả hoặc click để tải lên PDF/TXT/Docx"}
          </span>
          <input
            type="file"
            accept=".pdf,.txt,.docx,.md"
            onChange={handleFileUpload}
            className="hidden"
            disabled={isUploading}
          />
        </label>

        {/* Document list */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 pr-1">
          {documents.length === 0 ? (
            <div className="text-center text-[11px] text-muted-foreground py-6">
              Chưa có tài liệu nào. Hãy tải lên tài liệu để bắt đầu RAG.
            </div>
          ) : (
            documents.map((doc) => (
              <div
                key={doc.id}
                onClick={() => onSelectFile({ id: doc.id, filename: doc.filename })}
                className="group flex flex-col gap-0.5 p-2 rounded border border-border/40 hover:border-border bg-background/40 hover:bg-background cursor-pointer transition-all duration-150"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs font-medium truncate">{doc.filename}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-muted-foreground">
                    {(doc.file_size / (1024 * 1024)).toFixed(2)} MB
                  </span>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                      doc.status === "indexed"
                        ? "bg-success/15 text-success"
                        : doc.status === "parsing" || doc.status === "pending"
                        ? "bg-warning/15 text-warning animate-pulse"
                        : "bg-danger/15 text-danger"
                    }`}
                  >
                    {doc.status === "indexed"
                      ? "Đã nạp"
                      : doc.status === "parsing"
                      ? "Đang phân tích"
                      : doc.status === "pending"
                      ? "Đang chờ"
                      : "Lỗi"}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
