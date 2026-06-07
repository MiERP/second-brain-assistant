"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { MessageSquare, Eye } from "lucide-react";
import ChatPanel from "./chat-panel";
import PDFViewer from "./pdf-viewer";
import RichEditor from "./rich-editor";
import { API_BASE, apiFetch } from "@/lib/api";
import { Citation, Report } from "@/lib/types";
import { useToast } from "@/lib/toast";

interface WorkspaceLayoutProps {
  activeWorkspaceId: string;
  pdfViewerDoc: {
    id: string;
    filename: string;
    page?: number;
    highlightText?: string;
  } | null;
  setPdfViewerDoc: (doc: {
    id: string;
    filename: string;
    page?: number;
    highlightText?: string;
  } | null) => void;
  selectedFile: { id: string; filename: string; timestamp?: number } | null;
}

const DEFAULT_EDITOR_CONTENT = `
  <h2>Research report draft</h2>
  <p>Place the cursor here and use content from the AI chat to start drafting.</p>
`;

function htmlToPlainText(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export default function WorkspaceLayout({
  activeWorkspaceId,
  pdfViewerDoc,
  setPdfViewerDoc,
  selectedFile,
}: WorkspaceLayoutProps) {
  const [activeLeftTab, setActiveLeftTab] = useState<"chat" | "pdf">("chat");
  const [insertedText, setInsertedText] = useState<{ text: string; timestamp: number } | null>(null);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState(DEFAULT_EDITOR_CONTENT);
  const { toast } = useToast();

  useEffect(() => {
    if (!activeWorkspaceId) {
      setActiveReportId(null);
      setEditorContent(DEFAULT_EDITOR_CONTENT);
      return;
    }

    let active = true;
    const loadReport = async () => {
      try {
        const res = await apiFetch(`${API_BASE}/workspaces/${activeWorkspaceId}/reports`);
        if (!res.ok) throw new Error("Failed to load reports");
        const reports: Report[] = await res.json();
        if (!active) return;

        const latestReport = reports[0];
        if (latestReport) {
          setActiveReportId(latestReport.id);
          setEditorContent(
            latestReport.latest_snapshot.content_html ||
              latestReport.latest_snapshot.content_markdown ||
              DEFAULT_EDITOR_CONTENT
          );
        } else {
          setActiveReportId(null);
          setEditorContent(DEFAULT_EDITOR_CONTENT);
        }
      } catch (err) {
        console.error("Failed to load report draft", err);
        if (active) {
          toast("Không thể tải bản nháp báo cáo từ backend.", "error");
          setActiveReportId(null);
          setEditorContent(DEFAULT_EDITOR_CONTENT);
        }
      }
    };

    loadReport();
    return () => {
      active = false;
    };
  }, [activeWorkspaceId, toast]);

  // Switch to PDF tab when user clicks a file from sidebar
  useEffect(() => {
    if (selectedFile) {
      setPdfViewerDoc({
        id: selectedFile.id,
        filename: selectedFile.filename,
        page: 1,
      });
      // Defer state update to next tick to avoid synchronous cascading renders warning
      setTimeout(() => {
        setActiveLeftTab("pdf");
      }, 0);
    }
  }, [selectedFile, setPdfViewerDoc]);

  // Handle citation click: Switch tab to PDF and pass detail to viewer
  const handleCitationClick = (citation: Citation) => {
    setPdfViewerDoc({
      id: citation.document_id,
      filename: citation.filename,
      page: citation.page,
      highlightText: citation.snippet,
    });
    setTimeout(() => {
      setActiveLeftTab("pdf");
    }, 0);
  };

  // Handle applying AI text draft to Editor cursor
  const handleApplyToEditor = (text: string) => {
    setInsertedText({
      text,
      timestamp: Date.now(),
    });
  };

  const handleSaveEditorContent = useCallback(
    async (htmlContent: string) => {
      if (!activeWorkspaceId) return;

      const payload = {
        title: "Workspace report",
        content_markdown: htmlToPlainText(htmlContent),
        content_html: htmlContent,
      };
      const endpoint = activeReportId
        ? `${API_BASE}/workspaces/${activeWorkspaceId}/reports/${activeReportId}`
        : `${API_BASE}/workspaces/${activeWorkspaceId}/reports`;
      const res = await apiFetch(endpoint, {
        method: activeReportId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        toast("Không thể lưu bản nháp báo cáo.", "error");
        throw new Error("Failed to save report draft");
      }

      const saved: Report = await res.json();
      setActiveReportId(saved.id);
    },
    [activeReportId, activeWorkspaceId, toast]
  );

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      <PanelGroup orientation="horizontal">
        {/* Left Panel: Chat & Document Viewer Tabs */}
        <Panel defaultSize={45} minSize={30} maxSize={70} className="flex flex-col h-full">
          {/* Tab selector */}
          <div className="flex border-b border-border bg-muted/40 text-xs font-semibold select-none">
            <button
              onClick={() => setActiveLeftTab("chat")}
              className={`flex items-center gap-1.5 px-4 py-2.5 border-r border-border transition-colors cursor-pointer ${
                activeLeftTab === "chat"
                  ? "bg-background text-primary border-t-2 border-t-primary"
                  : "text-muted-foreground hover:bg-muted/60"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Trò chuyện RAG
            </button>
            <button
              onClick={() => setActiveLeftTab("pdf")}
              className={`flex items-center gap-1.5 px-4 py-2.5 border-r border-border transition-colors cursor-pointer ${
                activeLeftTab === "pdf"
                  ? "bg-background text-primary border-t-2 border-t-primary"
                  : "text-muted-foreground hover:bg-muted/60"
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              Xem nguồn tài liệu
            </button>
          </div>

          {/* Tab contents */}
          <div className="flex-1 overflow-hidden">
            {activeLeftTab === "chat" ? (
              <ChatPanel
                workspaceId={activeWorkspaceId}
                onClickCitation={handleCitationClick}
                onApplyToEditor={handleApplyToEditor}
              />
            ) : (
              <PDFViewer documentInfo={pdfViewerDoc} workspaceId={activeWorkspaceId} />
            )}
          </div>
        </Panel>

        {/* Resize Handle */}
        <PanelResizeHandle className="w-[3px] hover:w-[6px] bg-border hover:bg-primary/50 transition-all cursor-col-resize h-full" />

        {/* Right Panel: Rich Text Editor */}
        <Panel defaultSize={55} minSize={30} maxSize={70}>
          <RichEditor
            insertedText={insertedText}
            contentHtml={editorContent}
            onSaveContent={handleSaveEditorContent}
          />
        </Panel>
      </PanelGroup>
    </div>
  );
}
