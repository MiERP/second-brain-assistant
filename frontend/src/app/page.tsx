"use client";

import React, { useEffect, useState } from "react";
import AuthDialog from "@/components/auth-dialog";
import WorkspaceSidebar from "@/components/workspace-sidebar";
import WorkspaceLayout from "@/components/workspace-layout";

export default function Home() {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("");
  const [authRequired, setAuthRequired] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ id: string; filename: string; timestamp?: number } | null>(null);
  const [pdfViewerDoc, setPdfViewerDoc] = useState<{
    id: string;
    filename: string;
    page?: number;
    highlightText?: string;
  } | null>(null);

  const handleSelectFile = (file: { id: string; filename: string }) => {
    setSelectedFile({ ...file, timestamp: Date.now() }); // force update hook trigger
  };

  useEffect(() => {
    const shouldRequireAuth =
      process.env.NEXT_PUBLIC_AUTH_REQUIRED === "true" &&
      !window.localStorage.getItem("access_token");
    if (shouldRequireAuth) {
      setAuthRequired(true);
    }

    const showAuth = () => setAuthRequired(true);
    window.addEventListener("auth-required", showAuth);
    return () => window.removeEventListener("auth-required", showAuth);
  }, []);

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-background">
      <AuthDialog open={authRequired} />

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
