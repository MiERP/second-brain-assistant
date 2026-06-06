"use client";

import React, { useState, useRef, useEffect } from "react";
import { Send, Sparkles, AlertCircle, FileText, ArrowRight, Copy, Check } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

interface Citation {
  id: number;
  filename: string;
  page: number;
  text: string;
}

interface ChatPanelProps {
  workspaceId: string;
  onClickCitation: (citation: { filename: string; page: number; text: string }) => void;
  onApplyToEditor: (text: string) => void;
}

export default function ChatPanel({
  workspaceId,
  onClickCitation,
  onApplyToEditor,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Xin chào! Tôi là Trợ lý Bộ não Thứ hai của bạn. Tôi có thể đọc các tài liệu bạn đã tải lên, trả lời câu hỏi, đối chiếu các thông tin và giúp bạn viết báo cáo. Hãy chọn một workspace bên trái và đặt câu hỏi cho tôi.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [thoughtStatus, setThoughtStatus] = useState<string | null>(null);
  const [thoughtLogs, setThoughtLogs] = useState<string[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const API_BASE = "http://localhost:8000";

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, thoughtStatus, thoughtLogs]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !workspaceId) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);
    setThoughtStatus("Đang phân tích câu hỏi...");
    setThoughtLogs(["Bắt đầu phân tích yêu cầu..."]);

    try {
      // API call to FastAPI backend
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          workspace_id: workspaceId,
          chat_history: messages.slice(-5).map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) throw new Error("API request failed");

      const contentType = res.headers.get("content-type") || "";

      // Check if response is Server-Sent Events (SSE) stream
      if (contentType.includes("text/event-stream")) {
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error("Cannot get stream reader");

        let done = false;
        let assistantReply = "";
        let collectedCitations: Citation[] = [];

        // Add placeholder message for assistant streaming reply
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        while (!done) {
          const { value, done: streamDone } = await reader.read();
          done = streamDone;
          if (value) {
            const chunk = decoder.decode(value);
            const lines = chunk.split("\n");
            
            for (const line of lines) {
              if (line.startsWith("event: ")) {
                const eventType = line.slice("event: ".length).trim();
                // e.g. event: status, event: text, event: citations
              } else if (line.startsWith("data: ")) {
                const rawData = line.slice("data: ".length).trim();
                try {
                  const parsed = JSON.parse(rawData);
                  if (parsed.node && parsed.message) {
                    setThoughtStatus(parsed.message);
                    setThoughtLogs((prev) => {
                      if (prev[prev.length - 1] === parsed.message) return prev;
                      return [...prev, parsed.message];
                    });
                  } else if (parsed.delta) {
                    assistantReply += parsed.delta;
                    setMessages((prev) => {
                      const updated = [...prev];
                      updated[updated.length - 1] = {
                        role: "assistant",
                        content: assistantReply,
                        citations: collectedCitations,
                      };
                      return updated;
                    });
                  } else if (Array.isArray(parsed)) {
                    collectedCitations = parsed;
                  } else if (parsed.message) {
                    setThoughtStatus(null);
                  }
                } catch {
                  // Fallback for simple strings
                  if (rawData) {
                    assistantReply += rawData;
                    setMessages((prev) => {
                      const updated = [...prev];
                      updated[updated.length - 1] = {
                        role: "assistant",
                        content: assistantReply,
                        citations: collectedCitations,
                      };
                      return updated;
                    });
                  }
                }
              }
            }
          }
        }
      } else {
        // Fallback for regular JSON response (current Backend stub)
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.response,
            citations: data.citations || [],
          },
        ]);
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Đã xảy ra lỗi khi kết nối với máy chủ AI. Vui lòng kiểm tra xem backend FastAPI đã khởi chạy chưa.",
        },
      ]);
    } finally {
      setIsLoading(false);
      setThoughtStatus(null);
    }
  };

  const handleCopyText = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Custom high-quality, dependency-free Markdown & Inline Citations formatter
  const renderMessageContent = (content: string, citations: Citation[] = []) => {
    if (!content) return null;

    // Matches bold **text**, headings ### text, list items - item, and citation markers like [1]
    const regex = /(\[\d+\]|\*\*.*?\*\*|###.*?\n|-.*?\n)/g;
    const parts = content.split(regex);

    return (
      <span className="leading-relaxed space-y-1 block text-foreground/90">
        {parts.map((part, i) => {
          // Check for citation brackets [1]
          const citMatch = part.match(/^\[(\d+)\]$/);
          if (citMatch) {
            const citId = parseInt(citMatch[1], 10);
            const citation = citations.find((c) => c.id === citId);
            if (citation) {
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onClickCitation(citation)}
                  className="inline-flex items-center justify-center font-bold text-[10px] w-5 h-5 mx-0.5 rounded-md bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 hover:border-primary/40 transition-all cursor-pointer align-baseline select-none"
                  title={`${citation.filename} (Trang ${citation.page})`}
                >
                  {citId}
                </button>
              );
            }
            return <span key={i}>{part}</span>;
          }

          // Bold syntax: **text**
          if (part.startsWith("**") && part.endsWith("**")) {
            return (
              <strong key={i} className="font-semibold text-foreground">
                {part.slice(2, -2)}
              </strong>
            );
          }

          // Header syntax: ### text
          if (part.startsWith("###")) {
            return (
              <h4 key={i} className="text-xs font-semibold uppercase tracking-wider text-primary mt-4 mb-1.5 first:mt-0 block">
                {part.replace("###", "").trim()}
              </h4>
            );
          }

          // Bullet list items syntax: - item
          if (part.startsWith("- ")) {
            return (
              <span key={i} className="flex items-start gap-1.5 pl-3 py-0.5 block text-foreground/90">
                <span className="w-1.5 h-1.5 rounded-full bg-primary/60 mt-1.5 flex-shrink-0" />
                <span>{part.slice(2).trim()}</span>
              </span>
            );
          }

          return <span key={i}>{part}</span>;
        })}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full bg-background border-r border-border">
      {/* Panel Header */}
      <div className="flex items-center gap-2 px-6 py-4 border-b border-border bg-card/25">
        <Sparkles className="h-4.5 w-4.5 text-primary" />
        <span className="font-semibold text-sm tracking-tight">Trò chuyện RAG</span>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex flex-col max-w-[85%] animate-fade-in ${
              msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
            }`}
          >
            {/* Message Bubble */}
            <div
              className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm relative group/bubble ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground font-medium rounded-tr-sm"
                  : "bg-card text-foreground rounded-tl-sm border border-border/60"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="pr-2">
                  <div className="whitespace-pre-line">{renderMessageContent(msg.content, msg.citations)}</div>
                  
                  {/* Inline Action Bar for Assistant Message */}
                  {index > 0 && (
                    <div className="mt-3.5 pt-2.5 border-t border-border/40 flex items-center justify-between gap-4">
                      {/* Copy Action Button */}
                      <button
                        onClick={() => handleCopyText(msg.content, index)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      >
                        {copiedIndex === index ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-success" />
                            <span className="text-success">Đã sao chép</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Sao chép</span>
                          </>
                        )}
                      </button>

                      {/* Apply draft to editor */}
                      <button
                        onClick={() => onApplyToEditor(msg.content)}
                        className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors cursor-pointer"
                      >
                        Đẩy sang Editor <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                msg.content
              )}
            </div>

            {/* Citations Box */}
            {msg.citations && msg.citations.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {msg.citations.map((cit) => (
                  <button
                    key={cit.id}
                    onClick={() => onClickCitation(cit)}
                    className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 bg-muted/60 hover:bg-muted text-foreground border border-border/80 rounded-full transition-all duration-150 cursor-pointer"
                  >
                    <FileText className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">
                      [{cit.id}] {cit.filename.slice(0, 15)}... (Tr. {cit.page})
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Thought Logs Tree (DeepSeek-style) */}
        {thoughtLogs.length > 0 && (
          <details
            className="group border border-border/60 bg-muted/30 hover:bg-muted/40 rounded-xl p-3.5 text-xs w-full max-w-[85%] mr-auto mb-2 select-none transition-colors"
            open={!!thoughtStatus}
          >
            <summary className="flex items-center justify-between cursor-pointer font-medium text-muted-foreground hover:text-foreground list-none">
              <span className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary animate-pulse" />
                <span>Tiến trình suy luận ({thoughtLogs.length} bước)</span>
              </span>
              <span className="transition-transform group-open:rotate-180 text-muted-foreground">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </summary>
            <div className="mt-3 pl-2.5 border-l border-primary/20 flex flex-col gap-2 text-muted-foreground animate-fade-in">
              {thoughtLogs.map((step, sIdx) => {
                const isLast = sIdx === thoughtLogs.length - 1 && thoughtStatus;
                return (
                  <div key={sIdx} className="flex items-center gap-2 text-[11px]">
                    <div className={`w-1.5 h-1.5 rounded-full ${isLast ? "bg-primary animate-pulse" : "bg-muted-foreground/30"}`} />
                    <span className={isLast ? "text-primary font-medium" : ""}>{step}</span>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSend} className="p-4 border-t border-border bg-card/25">
        <div className="relative flex items-center">
          <input
            type="text"
            placeholder={
              workspaceId ? "Hỏi về tài liệu trong workspace..." : "Chọn workspace để gửi tin..."
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading || !workspaceId}
            className="w-full pl-4 pr-12 py-3 rounded-full border border-border focus:outline-none focus:border-primary bg-background focus:ring-1 focus:ring-primary/20 text-sm disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading || !workspaceId}
            className="absolute right-1.5 p-2 bg-primary text-primary-foreground rounded-full hover:bg-primary/95 focus:outline-none transition-colors disabled:opacity-30 disabled:hover:bg-primary"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

// Simple refresh icon for spinner
function RefreshCw(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M16 3h5v5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 21H3v-5" />
    </svg>
  );
}
