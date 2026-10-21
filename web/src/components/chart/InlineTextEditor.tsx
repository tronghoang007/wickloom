"use client";

import { useDrawingStore } from "@/drawings/store";
import { optOf, tableCells } from "@/drawings/tools";
import type { Drawing } from "@/drawings/types";
import { useEffect, useRef, useState } from "react";

// Ô gõ text ngay trên chart cho Text/Note/Callout/Pin/... (thay window.prompt).
// Enter: xong, Shift+Enter: xuống dòng, Esc: hủy, click ra ngoài: xong.
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
  const size = cell ? Number(optOf(d, "fontSize")) || 14 : d.type === "text" ? 12 + d.width * 2 : 12;
  return (
    <Editor
      key={`${d.id}|${cell ?? ""}`}
      d={d}
      initial={initial}
      size={size}
      at={at}
      anchor={() => api.textAnchor(d.id)}
      onDone={(t) => api.endEdit(t)}
    />
  );
}

type Pt = { x: number; y: number };

type EditorProps = { d: Drawing; initial: string; size: number; at: Pt; anchor: () => Pt | null; onDone: (text: string | null) => void };

function Editor({ d, initial, size, at: start, anchor, onDone }: EditorProps) {
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
      if (p) setAt((cur) => (Math.abs(cur.x - p.x) > 0.5 || Math.abs(cur.y - p.y) > 0.5 ? p : cur));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anchor]);

  const lines = text.split("\n");
  return (
    <textarea
      ref={ref}
      value={text}
      rows={lines.length}
      cols={Math.max(8, ...lines.map((l) => l.length + 1))}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(text);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
      className="absolute z-30 resize-none overflow-hidden rounded border border-[var(--accent)] bg-[var(--bg)] px-1 py-0.5 leading-[1.3] text-[var(--fg)] outline-none"
      style={{ left: at.x, top: at.y - size * 0.65 - 3, fontSize: size, color: d.textColor ?? undefined }}
    />
  );
}
