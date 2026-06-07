export interface Workspace {
  id: string;
  name: string;
  description?: string;
  created_at?: string;
}

export interface Document {
  id: string;
  workspace_id: string;
  filename: string;
  file_size: number;
  status: string;
  page_count?: number;
  created_at: string;
}

export interface ReportSnapshot {
  id: string;
  report_id: string;
  version: number;
  content_markdown: string;
  content_html?: string | null;
  created_at: string;
}

export interface Report {
  id: string;
  workspace_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  latest_snapshot: ReportSnapshot;
}

export interface Citation {
  id: number;
  document_id: string;
  filename: string;
  page: number;
  snippet: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}
