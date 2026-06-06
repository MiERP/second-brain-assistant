"use client";

import React, { useEffect, useState } from "react";
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
  FileDown,
  LayoutGrid
} from "lucide-react";

interface RichEditorProps {
  insertedText: { text: string; timestamp: number } | null;
  onSaveContent: (htmlContent: string) => void;
}

export default function RichEditor({ insertedText, onSaveContent }: RichEditorProps) {
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving">("saved");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        horizontalRule: false, // disabled to use the custom one
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
    content: `
      <h2>Báo cáo Nghiên cứu và So sánh Công nghệ Pin: Tesla vs BYD</h2>
      <p>Đặt con trỏ chuột tại đây và nhấn nút <strong>"Đẩy sang Editor"</strong> ở phần hội thoại AI để chèn thêm nội dung báo cáo tự động.</p>
    `,
    onUpdate({ editor }) {
      setSaveStatus("saving");
    },
  });

  // Debounced autosave simulation
  useEffect(() => {
    if (!editor) return;
    const interval = setTimeout(() => {
      if (saveStatus === "saving") {
        onSaveContent(editor.getHTML());
        setSaveStatus("saved");
      }
    }, 2000); // 2 seconds debounce

    return () => clearTimeout(interval);
  }, [saveStatus, editor]);

  // Handle programmatic insertion from Chat Panel
  useEffect(() => {
    if (editor && insertedText) {
      editor.chain().focus().insertContent(insertedText.text).run();
      setSaveStatus("saving");
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
      {/* Editor Toolbar */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-border bg-card/20 text-xs">
        <div className="flex items-center gap-1 flex-wrap">
          {/* Text Style */}
          <button
            onClick={toggleBold}
            className={`p-1.5 rounded hover:bg-muted transition-colors ${
              editor.isActive("bold") ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
            title="Đậm"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            onClick={toggleItalic}
            className={`p-1.5 rounded hover:bg-muted transition-colors ${
              editor.isActive("italic") ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
            title="Nghiêng"
          >
            <Italic className="h-4 w-4" />
          </button>

          <div className="w-[1px] h-4 bg-border mx-1" />

          {/* Headings */}
          <button
            onClick={toggleHeading1}
            className={`p-1.5 rounded hover:bg-muted transition-colors ${
              editor.isActive("heading", { level: 1 }) ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
            title="Tiêu đề 1"
          >
            <Heading1 className="h-4 w-4" />
          </button>
          <button
            onClick={toggleHeading2}
            className={`p-1.5 rounded hover:bg-muted transition-colors ${
              editor.isActive("heading", { level: 2 }) ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
            title="Tiêu đề 2"
          >
            <Heading2 className="h-4 w-4" />
          </button>

          <div className="w-[1px] h-4 bg-border mx-1" />

          {/* Lists */}
          <button
            onClick={toggleBulletList}
            className={`p-1.5 rounded hover:bg-muted transition-colors ${
              editor.isActive("bulletList") ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
            title="Danh sách dấu chấm"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={toggleOrderedList}
            className={`p-1.5 rounded hover:bg-muted transition-colors ${
              editor.isActive("orderedList") ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
            title="Danh sách số"
          >
            <ListOrdered className="h-4 w-4" />
          </button>
          <button
            onClick={toggleBlockquote}
            className={`p-1.5 rounded hover:bg-muted transition-colors ${
              editor.isActive("blockquote") ? "bg-muted text-primary" : "text-muted-foreground"
            }`}
            title="Trích dẫn khối"
          >
            <Quote className="h-4 w-4" />
          </button>

          <div className="w-[1px] h-4 bg-border mx-1" />

          {/* Alignments */}
          <button
            onClick={setAlignLeft}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
            title="Căn trái"
          >
            <AlignLeft className="h-4 w-4" />
          </button>
          <button
            onClick={setAlignCenter}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
            title="Căn giữa"
          >
            <AlignCenter className="h-4 w-4" />
          </button>
          <button
            onClick={setAlignRight}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
            title="Căn phải"
          >
            <AlignRight className="h-4 w-4" />
          </button>

          <div className="w-[1px] h-4 bg-border mx-1" />

          {/* Extra tools */}
          <button
            onClick={insertTable}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
            title="Chèn bảng"
          >
            <TableIcon className="h-4 w-4" />
          </button>
          <button
            onClick={insertHorizontalRule}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
            title="Đường gạch ngang"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>

        {/* Status */}
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {saveStatus === "saved" ? (
            <div className="flex items-center gap-1 text-success font-medium">
              <CheckCircle className="h-3.5 w-3.5" />
              <span className="text-[10px]">Đã lưu cục bộ</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-warning animate-pulse font-medium">
              <Save className="h-3.5 w-3.5 animate-spin" />
              <span className="text-[10px]">Đang lưu nháp...</span>
            </div>
          )}
        </div>
      </div>

      {/* Editor Content Area */}
      <div className="flex-1 overflow-y-auto px-12 py-10">
        <div className="max-w-[700px] mx-auto">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
