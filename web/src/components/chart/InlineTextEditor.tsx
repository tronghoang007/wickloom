"use client";

import { useDrawingStore } from "@/drawings/store";
import { optOf, tableCells, textColorOf } from "@/drawings/tools";
import type { Drawing } from "@/drawings/types";
import { useEffect, useRef, useState } from "react";

// Ô gõ text ngay trên chart cho Text/Note/Callout/Pin/... (thay window.prompt).
// Enter: xong, Shift+Enter: xuống dòng, Esc: hủy, click ra ngoài: xong.
// Gõ trên nhãn "+ Add text" của đường / hộp (label): như TV, Enter xuống dòng, Esc hoặc click ra ngoài: xong; chữ nằm đúng chỗ nhãn, xoay theo đường.
export default function InlineTextEditor() {
  const editing = useDrawingStore((s) => s.editing);
  const drawings = useDrawingStore((s) => s.drawings);
  const api = useDrawingStore((s) => s.api);
  const d = editing && drawings.find((x) => x.id === editing.id);
  const at = d && api?.textAnchor(d.id);
  if (!d || !api || !at) return null;
  // Table: sửa từng ô, cỡ chữ theo bảng
  const cell = editing.cell;
  const initial = cell ? tableCells(d)[cell[0]]?.[cell[1]] ?? "" : d.text ?? "";
  const label = Boolean(editing.label);
  const size = label ? Number(optOf(d, "fontSize")) || 14 : cell ? Number(optOf(d, "fontSize")) || 14 : d.type === "text" ? 12 + d.width * 2 : 12;
  return (
    <Editor
      key={`${d.id}|${cell ?? ""}|${label}`}
      d={d}
      initial={initial}
      label={label}
      size={size}
      at={at}
      anchor={() => api.textAnchor(d.id)}
      onDone={(t) => api.endEdit(t)}
    />
  );
}

type Pt = { x: number; y: number; angle?: number };

type EditorProps = { d: Drawing; initial: string; label: boolean; size: number; at: Pt; anchor: () => Pt | null; onDone: (text: string | null) => void };

function Editor({ d, initial, label, size, at: start, anchor, onDone }: EditorProps) {
  const [text, setText] = useState(initial);
  const [at, setAt] = useState(start);
  const done = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const finish = (t: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(t);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // Đi theo hình khi chart cuộn / zoom trong lúc đang gõ
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const p = anchor();
      if (p) setAt((cur) => (Math.abs(cur.x - p.x) > 0.5 || Math.abs(cur.y - p.y) > 0.5 || cur.angle !== p.angle ? p : cur));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anchor]);

  const lines = text.split("\n");
  const commit = (t: string) => finish(label ? t.replace(/\s+$/, "") : t); // TV giữ dòng trống cuối; ở đây bỏ cho khỏi lệch chữ
  return (
    <textarea
      ref={ref}
      value={text}
      rows={lines.length}
      cols={Math.max(8, ...lines.map((l) => l.length + 1))}
      placeholder={label ? "Add text" : undefined}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => commit(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey && !label) {
          e.preventDefault();
          commit(text);
        } else if (e.key === "Escape") {
          e.preventDefault();
          if (label) commit(text); // như TV: Esc giữ chữ đã gõ
          else finish(null);
        }
      }}
      className={
        label
          ? "absolute z-30 resize-none overflow-hidden bg-transparent px-1 text-center leading-[1.3] outline-none placeholder:opacity-50"
          : "absolute z-30 resize-none overflow-hidden rounded border border-[var(--accent)] bg-[var(--bg)] px-1 py-0.5 leading-[1.3] text-[var(--fg)] outline-none"
      }
      style={
        label
          ? { left: at.x, top: at.y, fontSize: size, color: textColorOf(d), caretColor: textColorOf(d), transform: `translate(-50%, -50%) rotate(${at.angle ?? 0}rad)` }
          : { left: at.x, top: at.y - size * 0.65 - 3, fontSize: size, color: d.textColor ?? undefined }
      }
    />
  );
}
