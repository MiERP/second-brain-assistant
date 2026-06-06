"use client";

import React, { useState } from "react";
import WorkspaceSidebar from "@/components/workspace-sidebar";
import WorkspaceLayout from "@/components/workspace-layout";

export default function Home() {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("default");
  const [selectedFile, setSelectedFile] = useState<{ id: string; filename: string } | null>(null);
  const [pdfViewerDoc, setPdfViewerDoc] = useState<{
    id: string;
    filename: string;
    page?: number;
    highlightText?: string;
  } | null>(null);

  const handleSelectFile = (file: { id: string; filename: string }) => {
    setSelectedFile({ ...file, timestamp: Date.now() } as any); // force update hook trigger
  };

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Sidebar: Workspaces & Local Files Ingestion */}
      <WorkspaceSidebar
        activeWorkspaceId={activeWorkspaceId}
        setActiveWorkspaceId={(id) => {
          setActiveWorkspaceId(id);
          setSelectedFile(null); // clear file view on workspace switch
        }}
        onSelectFile={handleSelectFile}
      />

      {/* Main Split-Screen Workspace (Chat, Viewer & Editor) */}
      <WorkspaceLayout
        activeWorkspaceId={activeWorkspaceId}
        pdfViewerDoc={pdfViewerDoc}
        setPdfViewerDoc={setPdfViewerDoc}
        selectedFile={selectedFile}
      />
    </main>
  );
}
