"use client";

import React, { useState, useEffect } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { MessageSquare, Eye } from "lucide-react";
import ChatPanel from "./chat-panel";
import PDFViewer from "./pdf-viewer";
import RichEditor from "./rich-editor";

interface WorkspaceLayoutProps {
  activeWorkspaceId: string;
  pdfViewerDoc: {
    id: string;
    filename: string;
    page?: number;
    highlightText?: string;
  } | null;
  setPdfViewerDoc: (doc: any) => void;
  selectedFile: { id: string; filename: string } | null;
}

export default function WorkspaceLayout({
  activeWorkspaceId,
  pdfViewerDoc,
  setPdfViewerDoc,
  selectedFile,
}: WorkspaceLayoutProps) {
  const [activeLeftTab, setActiveLeftTab] = useState<"chat" | "pdf">("chat");
  const [insertedText, setInsertedText] = useState<{ text: string; timestamp: number } | null>(null);

  // Switch to PDF tab when user clicks a file from sidebar
  useEffect(() => {
    if (selectedFile) {
      setPdfViewerDoc({
        id: selectedFile.id,
        filename: selectedFile.filename,
        page: 1,
      });
      setActiveLeftTab("pdf");
    }
  }, [selectedFile]);

  // Handle citation click: Switch tab to PDF and pass detail to viewer
  const handleCitationClick = (citation: { filename: string; page: number; text: string }) => {
    setPdfViewerDoc({
      id: Math.random().toString(), // temp ID
      filename: citation.filename,
      page: citation.page,
      highlightText: citation.text,
    });
    setActiveLeftTab("pdf");
  };

  // Handle applying AI text draft to Editor cursor
  const handleApplyToEditor = (text: string) => {
    setInsertedText({
      text,
      timestamp: Date.now(),
    });
  };

  const handleSaveEditorContent = (htmlContent: string) => {
    // In production, send to FastAPI endpoint to store a version snapshot in SQLite
    console.log("Autosaving editor content...", htmlContent.slice(0, 100));
  };

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      <PanelGroup orientation="horizontal">
        {/* Left Panel: Chat & Document Viewer Tabs */}
        <Panel defaultSize={45} minSize={30} maxSize={70} className="flex flex-col h-full">
          {/* Tab selector */}
          <div className="flex border-b border-border bg-muted/40 text-xs font-semibold select-none">
            <button
              onClick={() => setActiveLeftTab("chat")}
              className={`flex items-center gap-1.5 px-4 py-2.5 border-r border-border transition-colors ${
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
              className={`flex items-center gap-1.5 px-4 py-2.5 border-r border-border transition-colors ${
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
              <PDFViewer documentInfo={pdfViewerDoc} />
            )}
          </div>
        </Panel>

        {/* Resize Handle */}
        <PanelResizeHandle className="w-[3px] hover:w-[6px] bg-border hover:bg-primary/50 transition-all cursor-col-resize h-full" />

        {/* Right Panel: Rich Text Editor */}
        <Panel defaultSize={55} minSize={30} maxSize={70}>
          <RichEditor
            insertedText={insertedText}
            onSaveContent={handleSaveEditorContent}
          />
        </Panel>
      </PanelGroup>
    </div>
  );
}
