"use client";

import React, { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";

import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Table as TableIcon,
  Save,
  CheckCircle,
  LayoutGrid,
  AlertCircle,
} from "lucide-react";

interface RichEditorProps {
  insertedText: { text: string; timestamp: number } | null;
  contentHtml: string;
  onSaveContent: (htmlContent: string) => Promise<void> | void;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function isTableSeparator(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseTable(lines: string[], startIndex: number) {
  const rows: string[][] = [];
  let index = startIndex;
  while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
    if (!isTableSeparator(lines[index])) {
      rows.push(
        lines[index]
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim())
      );
    }
    index += 1;
  }

  if (rows.length === 0) return { html: "", nextIndex: startIndex };
  const [head, ...body] = rows;
  const headerHtml = `<tr>${head.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr>`;
  const bodyHtml = body
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("");
  return { html: `<table><tbody>${headerHtml}${bodyHtml}</tbody></table>`, nextIndex: index };
}

function markdownToEditorHtml(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let bulletItems: string[] = [];
  let orderedItems: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  const flushLists = () => {
    if (bulletItems.length) {
      html.push(`<ul>${bulletItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
      bulletItems = [];
    }
    if (orderedItems.length) {
      html.push(`<ol>${orderedItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ol>`);
      orderedItems = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushLists();
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushLists();
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushParagraph();
      flushLists();
      const table = parseTable(lines, index);
      html.push(table.html);
      index = table.nextIndex - 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushLists();
      html.push(`<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushParagraph();
      flushLists();
      html.push("<hr>");
      continue;
    }

    const quote = line.match(/^>\s+(.*)$/);
    if (quote) {
      flushParagraph();
      flushLists();
      html.push(`<blockquote><p>${renderInlineMarkdown(quote[1])}</p></blockquote>`);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      orderedItems = [];
      bulletItems.push(bullet[1]);
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      bulletItems = [];
      orderedItems.push(ordered[1]);
      continue;
    }

    flushLists();
    paragraph.push(line);
  }

  flushParagraph();
  flushLists();
  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  return html.join("");
}

export default function RichEditor({ insertedText, contentHtml, onSaveContent }: RichEditorProps) {
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const loadedContentRef = useRef(contentHtml);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        horizontalRule: false,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      Highlight,
      HorizontalRule,
      Image,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
    ],
    content: contentHtml,
    immediatelyRender: false,
    onUpdate() {
      setSaveStatus("saving");
    },
  });

  useEffect(() => {
    if (!editor || loadedContentRef.current === contentHtml) return;
    loadedContentRef.current = contentHtml;
    editor.commands.setContent(contentHtml, { emitUpdate: false });
    setSaveStatus("saved");
  }, [contentHtml, editor]);

  useEffect(() => {
    if (!editor) return;
    const interval = setTimeout(async () => {
      if (saveStatus !== "saving") return;
      try {
        await onSaveContent(editor.getHTML());
        setSaveStatus("saved");
      } catch (err) {
        console.error("Failed to autosave editor content", err);
        setSaveStatus("error");
      }
    }, 2000);

    return () => clearTimeout(interval);
  }, [saveStatus, editor, onSaveContent]);

  useEffect(() => {
    if (editor && insertedText) {
      editor.chain().focus().insertContent(markdownToEditorHtml(insertedText.text)).run();
      setTimeout(() => {
        setSaveStatus("saving");
      }, 0);
    }
  }, [insertedText, editor]);

  if (!editor) {
    return null;
  }

  const toggleBold = () => editor.chain().focus().toggleBold().run();
  const toggleItalic = () => editor.chain().focus().toggleItalic().run();
  const toggleHeading1 = () => editor.chain().focus().toggleHeading({ level: 1 }).run();
  const toggleHeading2 = () => editor.chain().focus().toggleHeading({ level: 2 }).run();
  const toggleBulletList = () => editor.chain().focus().toggleBulletList().run();
  const toggleOrderedList = () => editor.chain().focus().toggleOrderedList().run();
  const toggleBlockquote = () => editor.chain().focus().toggleBlockquote().run();
  const insertHorizontalRule = () => editor.chain().focus().setHorizontalRule().run();
  const setAlignLeft = () => editor.chain().focus().setTextAlign("left").run();
  const setAlignCenter = () => editor.chain().focus().setTextAlign("center").run();
  const setAlignRight = () => editor.chain().focus().setTextAlign("right").run();
  const insertTable = () =>
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();

  return (
    <div className="flex flex-col h-full bg-background select-none">
      <div className="flex items-center justify-between px-6 py-2 border-b border-border bg-card/20 text-xs">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={toggleBold}
            className={`p-1.5 rounded hover:bg-muted transition-colors cursor-pointer ${
              editor.isActive("bold") ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
            title="Bold"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            onClick={toggleItalic}
            className={`p-1.5 rounded hover:bg-muted transition-colors cursor-pointer ${
              editor.isActive("italic") ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
            title="Italic"
          >
            <Italic className="h-4 w-4" />
          </button>

          <div className="w-[1px] h-4 bg-border mx-1" />

          <button
            onClick={toggleHeading1}
            className={`p-1.5 rounded hover:bg-muted transition-colors cursor-pointer ${
              editor.isActive("heading", { level: 1 }) ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
            title="Heading 1"
          >
            <Heading1 className="h-4 w-4" />
          </button>
          <button
            onClick={toggleHeading2}
            className={`p-1.5 rounded hover:bg-muted transition-colors cursor-pointer ${
              editor.isActive("heading", { level: 2 }) ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
            title="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </button>

          <div className="w-[1px] h-4 bg-border mx-1" />

          <button
            onClick={toggleBulletList}
            className={`p-1.5 rounded hover:bg-muted transition-colors cursor-pointer ${
              editor.isActive("bulletList") ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
            title="Bullet list"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={toggleOrderedList}
            className={`p-1.5 rounded hover:bg-muted transition-colors cursor-pointer ${
              editor.isActive("orderedList") ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
            title="Numbered list"
          >
            <ListOrdered className="h-4 w-4" />
          </button>
          <button
            onClick={toggleBlockquote}
            className={`p-1.5 rounded hover:bg-muted transition-colors cursor-pointer ${
              editor.isActive("blockquote") ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
            title="Block quote"
          >
            <Quote className="h-4 w-4" />
          </button>

          <div className="w-[1px] h-4 bg-border mx-1" />

          <button
            onClick={setAlignLeft}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
            title="Align left"
          >
            <AlignLeft className="h-4 w-4" />
          </button>
          <button
            onClick={setAlignCenter}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
            title="Align center"
          >
            <AlignCenter className="h-4 w-4" />
          </button>
          <button
            onClick={setAlignRight}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
            title="Align right"
          >
            <AlignRight className="h-4 w-4" />
          </button>

          <div className="w-[1px] h-4 bg-border mx-1" />

          <button
            onClick={insertTable}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
            title="Insert table"
          >
            <TableIcon className="h-4 w-4" />
          </button>
          <button
            onClick={insertHorizontalRule}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
            title="Horizontal rule"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 text-muted-foreground">
          {saveStatus === "saved" ? (
            <div className="flex items-center gap-1 text-success font-medium">
              <CheckCircle className="h-3.5 w-3.5" />
              <span className="text-[10px]">Saved</span>
            </div>
          ) : saveStatus === "error" ? (
            <div className="flex items-center gap-1 text-danger font-medium">
              <AlertCircle className="h-3.5 w-3.5" />
              <span className="text-[10px]">Save failed</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-warning animate-pulse font-medium">
              <Save className="h-3.5 w-3.5 animate-spin" />
              <span className="text-[10px]">Saving draft...</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-12 py-10">
        <div className="max-w-[700px] mx-auto">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
