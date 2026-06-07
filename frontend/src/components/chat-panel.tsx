"use client";

import React, { useState, useRef, useEffect } from "react";
import { Send, Sparkles, FileText, ArrowRight, Copy, Check } from "lucide-react";
import { API_BASE, apiFetch } from "@/lib/api";
import { Message, Citation } from "@/lib/types";
import { useToast } from "@/lib/toast";
import { useSseChat } from "@/hooks/use-sse-chat";

interface ChatPanelProps {
  workspaceId: string;
  onClickCitation: (citation: Citation) => void;
  onApplyToEditor: (text: string) => void;
}

const CodeBlock = ({ code, lang }: { code: string; lang: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative border border-border bg-muted/40 rounded-lg my-4 overflow-hidden group/code font-mono text-xs shadow-sm max-w-full text-left">
      <div className="flex items-center justify-between px-4 py-1.5 bg-muted border-b border-border select-none">
        <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
          {lang || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-success" />
              <span className="text-success">Đã chép</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Sao chép</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-foreground/90 leading-relaxed scrollbar-thin bg-card/45 select-text">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export default function ChatPanel({
  workspaceId,
  onClickCitation,
  onApplyToEditor,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Xin chào! Tôi là Trợ lý Bộ não Thứ hai của bạn. Tôi có thể đọc các tài liệu bạn đã tải lên, trả lời câu hỏi, đối chiếu thông tin và giúp bạn viết báo cáo. Hãy chọn một workspace bên trái và đặt câu hỏi cho tôi.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [thoughtStatus, setThoughtStatus] = useState<string | null>(null);
  const [thoughtLogs, setThoughtLogs] = useState<string[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { readStream } = useSseChat();

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
      const res = await apiFetch(`${API_BASE}/workspaces/${workspaceId}/chat`, {
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

      // Server-Sent Events (SSE) reader lives in useSseChat; this component owns UI state.
      if (contentType.includes("text/event-stream")) {
        let assistantReply = "";
        let collectedCitations: Citation[] = [];

        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        const applyAssistantReply = () => {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "assistant",
              content: assistantReply,
              citations: collectedCitations,
            };
            return updated;
          });
        };

        await readStream(res, {
          onStatus(message) {
            setThoughtStatus(message);
            setThoughtLogs((prev) => {
              if (prev[prev.length - 1] === message) return prev;
              return [...prev, message];
            });
          },
          onText(delta) {
            assistantReply += delta;
            applyAssistantReply();
          },
          onCitations(citations) {
            collectedCitations = citations;
          },
          onDone() {
            setThoughtStatus(null);
          },
          onError(message) {
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: "assistant",
                content: `Lỗi hệ thống: ${message}`,
              };
              return updated;
            });
            setThoughtStatus(null);
          },
          onRawText(text) {
            assistantReply += text;
            applyAssistantReply();
          },
        });
      } else {
        // Fallback for regular JSON response
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.response || "",
            citations: data.citations || [],
          },
        ]);
      }
    } catch (err) {
      console.error(err);
      toast("Không thể kết nối tới trợ lý AI. Vui lòng kiểm tra lại backend.", "error");
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
    toast("Đã sao chép phản hồi vào clipboard!", "success");
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Custom high-quality, dependency-free Markdown & Inline Citations formatter
  const renderMessageContent = (content: string, citations: Citation[] = []) => {
    if (!content) return null;

    // Scan for fenced code blocks
    const blocks: { type: "code" | "markdown"; content: string; lang?: string }[] = [];
    let lastIndex = 0;
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        blocks.push({
          type: "markdown",
          content: content.slice(lastIndex, match.index),
        });
      }
      blocks.push({
        type: "code",
        lang: match[1] || "",
        content: match[2],
      });
      lastIndex = codeBlockRegex.lastIndex;
    }
    if (lastIndex < content.length) {
      blocks.push({
        type: "markdown",
        content: content.slice(lastIndex),
      });
    }

    const renderInline = (text: string, inlineCitations: Citation[]): React.ReactNode => {
      const inlineRegex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|\[\d+\])/g;
      const parts = text.split(inlineRegex);

      return parts.map((part, index) => {
        // Citation check [1]
        const citMatch = part.match(/^\[(\d+)\]$/);
        if (citMatch) {
          const citId = parseInt(citMatch[1], 10);
          const citation = inlineCitations.find((c) => c.id === citId);
          if (citation) {
            return (
              <button
                key={index}
                type="button"
                onClick={() => onClickCitation(citation)}
                className="inline-flex items-center justify-center font-bold text-[10px] w-5 h-5 mx-0.5 rounded-md bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 hover:border-primary/40 transition-all cursor-pointer align-baseline select-none"
                title={`${citation.filename} (Trang ${citation.page})`}
              >
                {citId}
              </button>
            );
          }
          return part;
        }

        // Bold check **text**
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={index} className="font-semibold text-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        }

        // Italic check *text*
        if (part.startsWith("*") && part.endsWith("*")) {
          return (
            <em key={index} className="italic text-foreground/90">
              {part.slice(1, -1)}
            </em>
          );
        }

        // Inline code check `code`
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={index} className="px-1.5 py-0.5 bg-muted border border-border/60 rounded text-xs font-mono text-primary select-all">
              {part.slice(1, -1)}
            </code>
          );
        }

        return part;
      });
    };

    const isTableSeparator = (line: string) =>
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

    const parseTableCells = (line: string) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());

    return (
      <div className="space-y-1 block text-foreground/90 text-left">
        {blocks.map((block, bIdx) => {
          if (block.type === "code") {
            return (
              <CodeBlock
                key={`code-${bIdx}`}
                code={block.content}
                lang={block.lang || ""}
              />
            );
          }

          // Split block by lines and parse markdown structures
          const lines = block.content.split("\n");
          const subBlocks: React.ReactNode[] = [];
          let currentList: { type: "bullet" | "ordered"; items: string[] } | null = null;
          let currentParagraph: string[] = [];

          const flushParagraph = () => {
            if (currentParagraph.length > 0) {
              const text = currentParagraph.join(" ");
              subBlocks.push(
                <p key={`p-${subBlocks.length}`} className="mb-3 leading-relaxed text-foreground/90 last:mb-0">
                  {renderInline(text, citations)}
                </p>
              );
              currentParagraph = [];
            }
          };

          const flushList = () => {
            if (currentList) {
              const listKey = `list-${subBlocks.length}`;
              if (currentList.type === "bullet") {
                subBlocks.push(
                  <ul key={listKey} className="list-disc pl-5 mb-3 space-y-1 text-foreground/90">
                    {currentList.items.map((item, idx) => (
                      <li key={idx}>{renderInline(item, citations)}</li>
                    ))}
                  </ul>
                );
              } else {
                subBlocks.push(
                  <ol key={listKey} className="list-decimal pl-5 mb-3 space-y-1 text-foreground/90">
                    {currentList.items.map((item, idx) => (
                      <li key={idx}>{renderInline(item, citations)}</li>
                    ))}
                  </ol>
                );
              }
              currentList = null;
            }
          };

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (!trimmed) {
              flushList();
              flushParagraph();
              continue;
            }

            if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
              flushList();
              flushParagraph();
              const rows: string[][] = [];
              let nextIndex = i;
              while (
                nextIndex < lines.length &&
                lines[nextIndex].includes("|") &&
                lines[nextIndex].trim()
              ) {
                if (!isTableSeparator(lines[nextIndex])) {
                  rows.push(parseTableCells(lines[nextIndex]));
                }
                nextIndex += 1;
              }
              const [head, ...body] = rows;
              subBlocks.push(
                <div key={`table-${subBlocks.length}`} className="my-3 max-w-full overflow-x-auto rounded-md border border-border/60">
                  <table className="w-full min-w-max border-collapse text-xs">
                    <thead className="bg-muted/60">
                      <tr>
                        {head.map((cell, cellIndex) => (
                          <th key={cellIndex} className="border-b border-border/60 px-3 py-2 text-left font-semibold text-foreground">
                            {renderInline(cell, citations)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {body.map((row, rowIndex) => (
                        <tr key={rowIndex} className="odd:bg-background even:bg-muted/20">
                          {row.map((cell, cellIndex) => (
                            <td key={cellIndex} className="border-t border-border/40 px-3 py-2 align-top">
                              {renderInline(cell, citations)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
              i = nextIndex - 1;
              continue;
            }

            const h1Match = line.match(/^#\s+(.*)$/);
            const h2Match = line.match(/^##\s+(.*)$/);
            const h3Match = line.match(/^###\s+(.*)$/);

            if (h1Match) {
              flushList();
              flushParagraph();
              subBlocks.push(
                <h1 key={`h1-${subBlocks.length}`} className="text-xl font-bold text-foreground mt-4 mb-2 first:mt-0 block">
                  {renderInline(h1Match[1], citations)}
                </h1>
              );
              continue;
            }
            if (h2Match) {
              flushList();
              flushParagraph();
              subBlocks.push(
                <h2 key={`h2-${subBlocks.length}`} className="text-lg font-semibold text-foreground mt-3 mb-2 first:mt-0 block">
                  {renderInline(h2Match[1], citations)}
                </h2>
              );
              continue;
            }
            if (h3Match) {
              flushList();
              flushParagraph();
              subBlocks.push(
                <h3 key={`h3-${subBlocks.length}`} className="text-sm font-semibold uppercase tracking-wider text-primary mt-3 mb-1.5 first:mt-0 block">
                  {renderInline(h3Match[1], citations)}
                </h3>
              );
              continue;
            }

            if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
              flushList();
              flushParagraph();
              subBlocks.push(<hr key={`hr-${subBlocks.length}`} className="my-4 border-border" />);
              continue;
            }

            const bqMatch = line.match(/^>\s*(.*)$/);
            if (bqMatch) {
              flushList();
              flushParagraph();
              subBlocks.push(
                <blockquote key={`bq-${subBlocks.length}`} className="border-l-4 border-primary/40 pl-4 italic my-3 text-muted-foreground bg-muted/20 py-1.5 rounded-r-md block">
                  {renderInline(bqMatch[1], citations)}
                </blockquote>
              );
              continue;
            }

            const bulletMatch = line.match(/^[-*]\s+(.*)$/);
            if (bulletMatch) {
              flushParagraph();
              if (!currentList || currentList.type !== "bullet") {
                flushList();
                currentList = { type: "bullet", items: [] };
              }
              currentList.items.push(bulletMatch[1]);
              continue;
            }

            const orderedMatch = line.match(/^(\d+)\.\s+(.*)$/);
            if (orderedMatch) {
              flushParagraph();
              if (!currentList || currentList.type !== "ordered") {
                flushList();
                currentList = { type: "ordered", items: [] };
              }
              currentList.items.push(orderedMatch[2]);
              continue;
            }

            if (currentList) {
              flushList();
            }
            currentParagraph.push(line);
          }
          flushList();
          flushParagraph();

          return <React.Fragment key={bIdx}>{subBlocks}</React.Fragment>;
        })}
      </div>
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
                  <div>{renderMessageContent(msg.content, msg.citations)}</div>
                  
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
