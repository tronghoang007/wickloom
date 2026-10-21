"use client";

import { useDrawingStore } from "@/drawings/store";
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
  return <Editor key={d.id} d={d} at={at} onDone={(t) => api.endEdit(t)} />;
}

function Editor({ d, at, onDone }: { d: Drawing; at: { x: number; y: number }; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(d.text ?? "");
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

  const size = d.type === "text" ? 12 + d.width * 2 : 12;
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
