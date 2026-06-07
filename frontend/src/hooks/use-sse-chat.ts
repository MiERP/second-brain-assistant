"use client";

import { useCallback } from "react";
import { Citation } from "@/lib/types";

interface ChatStreamHandlers {
  onStatus: (message: string) => void;
  onText: (delta: string) => void;
  onCitations: (citations: Citation[]) => void;
  onDone: () => void;
  onError: (message: string) => void;
  onRawText: (text: string) => void;
}

export function useSseChat() {
  const readStream = useCallback(
    async (response: Response, handlers: ChatStreamHandlers) => {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Cannot get stream reader");

      const decoder = new TextDecoder();
      let done = false;
      let buffer = "";
      let currentEvent = "";

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (!value) continue;

        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith("event: ")) {
            currentEvent = trimmedLine.slice("event: ".length).trim();
            continue;
          }

          if (!trimmedLine.startsWith("data: ")) continue;

          const rawData = trimmedLine.slice("data: ".length).trim();
          try {
            const parsed = JSON.parse(rawData);
            if (currentEvent === "status") {
              handlers.onStatus(parsed.message || "");
            } else if (currentEvent === "text" || !currentEvent) {
              handlers.onText(parsed.delta !== undefined ? parsed.delta : parsed.response || rawData);
            } else if (currentEvent === "citations") {
              handlers.onCitations(Array.isArray(parsed) ? parsed : []);
            } else if (currentEvent === "done") {
              handlers.onDone();
            } else if (currentEvent === "error") {
              handlers.onError(parsed.message || rawData);
            }
          } catch {
            if (rawData) {
              handlers.onRawText(rawData);
            }
          } finally {
            currentEvent = "";
          }
        }
      }
    },
    []
  );

  return { readStream };
}
