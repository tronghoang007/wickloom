"use client";

import { useLayoutStore } from "@/store/layout";
import { FULL, dragSizes, gutters, paneRects, splitAt, type Gutter } from "@/store/layoutTree";
import { startPaneSync } from "@/store/paneSync";
import { useEffect, useMemo, useRef } from "react";
import { FullscreenI } from "../icons";
import Chart from "./Chart";

const MIN_PX = 160; // ô nhỏ nhất khi kéo splitter
const pct = (n: number) => `${n * 100}%`;
const idNum = (id: string) => Number(id.slice(1)) || 0;

/** Lưới các chart theo cây chia ô của layout. Mọi pane render PHẲNG (absolute theo tỉ lệ) và key theo id, nên đổi mẫu /
 *  phóng to không làm Chart nào bị tạo lại (giữ WebSocket, dữ liệu, góc nhìn). */
export default function ChartGrid() {
  const panes = useLayoutStore((s) => s.panes);
  const tree = useLayoutStore((s) => s.tree);
  const activeId = useLayoutStore((s) => s.activeId);
  const maximized = useLayoutStore((s) => s.maximized);
  const revision = useLayoutStore((s) => s.revision); // mở layout khác → pane mới: dựng lại mọi Chart
  const boxRef = useRef<HTMLDivElement>(null);
  const rects = useMemo(() => paneRects(tree), [tree]);
  const lines = useMemo(() => gutters(tree), [tree]);
  const ids = useMemo(() => Object.keys(panes).sort((a, b) => idNum(a) - idNum(b)), [panes]); // thứ tự DOM ổn định
  const multi = ids.length > 1;
  useEffect(() => startPaneSync(), []); // "Sync in layout": symbol / khung đi theo giữa các chart

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden">
      {ids.map((id) => {
        const hidden = maximized !== null && id !== maximized;
        // pane bị ẩn vẫn giữ nguyên kích thước (autoSize của chart không về 0) và vẫn mount
        const r = maximized !== null ? FULL : rects[id] ?? FULL;
        return (
          <PaneFrame key={`${revision}:${id}`} id={id} rect={r} hidden={hidden} multi={multi} active={id === activeId} maximized={id === maximized} />
        );
      })}
      {maximized === null && lines.map((g) => <Splitter key={`${g.path.join(".")}/${g.index}`} g={g} boxRef={boxRef} />)}
    </div>
  );
}

function PaneFrame({
  id, rect, hidden, multi, active, maximized,
}: {
  id: string;
  rect: { x: number; y: number; w: number; h: number };
  hidden: boolean;
  multi: boolean;
  active: boolean;
  maximized: boolean;
}) {
  return (
    <div
      className={`group absolute ${hidden ? "pointer-events-none invisible" : ""} ${maximized ? "z-10" : ""}`}
      style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
      // bấm vào chart nào thì chart đó active (Chart cũng tự làm; đây phủ cả nút Maximize)
      onPointerDownCapture={() => useLayoutStore.getState().setActive(id)}
      data-pane={id}
    >
      <Chart paneId={id} />
      {multi && (
        <>
          {/* viền: pane active có viền accent, các pane khác viền mảnh theo theme */}
          <div
            className={`pointer-events-none absolute inset-0 z-[25] border ${active ? "border-[var(--accent)]" : "border-[var(--border)]"}`}
          />
          <button
            type="button"
            title={maximized ? "Restore chart" : "Maximize chart"}
            aria-label={maximized ? "Restore chart" : "Maximize chart"}
            onClick={() => useLayoutStore.getState().setMaximized(maximized ? null : id)}
            className={`absolute right-[78px] top-1 z-30 flex h-6 w-6 items-center justify-center rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] hover:bg-[var(--hover)] ${maximized ? "text-[var(--accent-text)]" : "opacity-0 group-hover:opacity-100"}`}
          >
            <span className="scale-[0.6]">
              <FullscreenI />
            </span>
          </button>
        </>
      )}
    </div>
  );
}

function Splitter({ g, boxRef }: { g: Gutter; boxRef: React.RefObject<HTMLDivElement | null> }) {
  const vertical = g.dir === "row"; // row = các ô cạnh nhau → đường chia dọc, kéo ngang
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    const start = useLayoutStore.getState().tree;
    const split = splitAt(start, g.path);
    if (!box || !split) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const r = box.getBoundingClientRect();
    const parentPx = vertical ? g.parent.w * r.width : g.parent.h * r.height;
    const from = vertical ? e.clientX : e.clientY;
    const startSizes = [...split.sizes];
    const min = Math.min(MIN_PX / parentPx, 0.5);
    const move = (ev: PointerEvent) => {
      const delta = ((vertical ? ev.clientX : ev.clientY) - from) / parentPx;
      useLayoutStore.getState().resizeAt(g.path, dragSizes(startSizes, g.index, delta, min));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const reset = () => {
    const split = splitAt(useLayoutStore.getState().tree, g.path);
    if (split) useLayoutStore.getState().resizeAt(g.path, split.sizes.map(() => 1 / split.sizes.length));
  };
  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      title="Kéo để đổi kích thước, bấm đúp để chia đều"
      onPointerDown={onDown}
      onDoubleClick={reset}
      className={`absolute z-30 hover:bg-[var(--accent)]/40 ${vertical ? "cursor-col-resize" : "cursor-row-resize"}`}
      style={
        vertical
          ? { left: `calc(${pct(g.line.x)} - 3px)`, top: pct(g.line.y), width: 6, height: pct(g.line.h) }
          : { top: `calc(${pct(g.line.y)} - 3px)`, left: pct(g.line.x), height: 6, width: pct(g.line.w) }
      }
    />
  );
}
