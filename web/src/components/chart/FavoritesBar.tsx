"use client";

import { useDrawingStore } from "@/drawings/store";
import { SPEC } from "@/drawings/tools";
import { useEffect, useRef, useState } from "react";
import { ToolIcon } from "../toolIcons";

export default function FavoritesBar() {
  const { favorites, showFavs, tool, api } = useDrawingStore();
  const [pos, setPos] = useState(() => useDrawingStore.getState().favoritesPos);
  const dragRef = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      bar.scrollLeft += e.deltaX || e.deltaY;
    };
    bar.addEventListener("wheel", onWheel, { passive: false });
    return () => bar.removeEventListener("wheel", onWheel);
  }, [showFavs, favorites.length]);

  if (!showFavs || favorites.length === 0) return null;

  return (
    <div
      ref={barRef}
      className="absolute left-1/2 top-2 z-20 flex max-w-[calc(100%-16px)] items-center gap-0.5 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 shadow-lg [scrollbar-width:none]"
      style={{ transform: `translate(calc(-50% + ${pos.x}px), ${pos.y}px)` }}
    >
      <div
        className="mr-1 flex h-8 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-[var(--muted)]"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = {
            sx: e.clientX,
            sy: e.clientY,
            ox: pos.x,
            oy: pos.y,
          };
        }}
        onPointerMove={(e) => {
          const s = dragRef.current;
          if (!s) return;
          if (e.buttons === 0) {
            dragRef.current = null;
            return;
          }
          const bar = barRef.current;
          const bounds = bar?.parentElement?.getBoundingClientRect();
          if (!bar || !bounds) return;
          const width = bar.offsetWidth;
          const height = bar.offsetHeight;
          const baseX = (bounds.width - width) / 2;
          const nextX = s.ox + e.clientX - s.sx;
          const nextY = s.oy + e.clientY - s.sy;
          setPos({
            x: Math.max(-baseX, Math.min(bounds.width - width - baseX, nextX)),
            y: Math.max(-8, Math.min(bounds.height - height - 8, nextY)),
          });
        }}
        onPointerUp={() => {
          dragRef.current = null;
          useDrawingStore.setState({ favoritesPos: pos });
        }}
        onPointerCancel={() => (dragRef.current = null)}
        onLostPointerCapture={() => (dragRef.current = null)}
      >
        ⋮⋮
      </div>
      {favorites
        .filter((id) => SPEC[id])
        .map((id) => (
          <button
            key={id}
            title={SPEC[id].label}
            onClick={() => api?.setTool(tool === id ? null : id)}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded ${tool === id ? "bg-[var(--hover)] text-[var(--accent)]" : "hover:bg-[var(--hover)]"}`}
          >
            <ToolIcon id={id} size={20} />
          </button>
        ))}
    </div>
  );
}
