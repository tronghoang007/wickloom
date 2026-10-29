"use client";

import { useDrawingStore } from "@/drawings/store";
import { SPEC } from "@/drawings/tools";
import { useLayoutMode } from "@/lib/layoutMode";
import { useEffect, useRef, useState } from "react";
import { ToolIcon } from "../toolIcons";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const TOP = 8; // top-2: vị trí gốc của thanh, y = 0
const PRICE_AXIS = 70; // chừa trục giá bên phải khi dời thanh sang cạnh legend
const TIME_AXIS = 36; // chừa trục thời gian khi đặt thanh ở đáy

export default function FavoritesBar() {
  const { favorites, showFavs, tool, api } = useDrawingStore();
  const phone = useLayoutMode() === "phone";
  const [pos, setPos] = useState(() => useDrawingStore.getState().favoritesPos);
  const dragRef = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // Kích thước vùng chart chứa thanh + của thanh: mở / đóng thanh bên phải, đổi layout, thêm / bớt công cụ yêu thích đều làm đổi → vị trí phải kẹp lại theo kích thước MỚI
  // lr: mép phải hàng legend đầu (mã · khung · O H L C) tính từ mép trái vùng chart, để vị trí mặc định không đè lên nó
  const [size, setSize] = useState({ pw: 0, ph: 0, bw: 0, bh: 0, lr: 0 });

  useEffect(() => {
    const bar = barRef.current;
    const parent = bar?.parentElement;
    if (!bar || !parent) return;
    const legend = parent.querySelector<HTMLElement>("[data-legend-row]");
    const measure = () =>
      setSize({
        pw: parent.clientWidth,
        ph: parent.clientHeight,
        bw: bar.offsetWidth,
        bh: bar.offsetHeight,
        lr: legend ? Math.round(legend.getBoundingClientRect().right - parent.getBoundingClientRect().left) : 0,
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    ro.observe(bar);
    if (legend) ro.observe(legend);
    return () => ro.disconnect();
  }, [showFavs, favorites.length]);

  /** Giới hạn dịch chuyển để thanh luôn nằm trọn trong vùng chart (gốc: giữa ngang, cách mép trên 8px). */
  const limits = (sz: { pw: number; ph: number; bw: number; bh: number }) => {
    const baseX = (sz.pw - sz.bw) / 2;
    return { minX: -baseX, maxX: sz.pw - sz.bw - baseX, minY: -TOP, maxY: sz.ph - sz.bh - TOP };
  };
  /** Chưa kéo lần nào (vị trí gốc giữa trên): nếu đè lên hàng legend thì dời sang phải legend; không đủ chỗ (tablet, laptop nhỏ) thì xuống đáy chart. */
  const defaultPos = (sz: typeof size) => {
    const baseX = (sz.pw - sz.bw) / 2;
    const left = sz.lr + 12;
    if (left <= baseX) return { x: 0, y: 0 };
    if (left + sz.bw <= sz.pw - PRICE_AXIS) return { x: left - baseX, y: 0 };
    return { x: 0, y: sz.ph - sz.bh - TOP - TIME_AXIS };
  };
  // `pos` giữ vị trí người dùng chọn (đã lưu); vị trí HIỆN ra là bản kẹp theo kích thước hiện tại nên đóng sidebar lại thì thanh về chỗ cũ
  const shown = (() => {
    if (!size.pw) return pos;
    const l = limits(size);
    const p = pos.x === 0 && pos.y === 0 ? defaultPos(size) : pos;
    return { x: clamp(p.x, l.minX, Math.max(l.minX, l.maxX)), y: clamp(p.y, l.minY, Math.max(l.minY, l.maxY)) };
  })();

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

  // phone: chưa có thanh vẽ (docs/mobile-responsive-plan.md M5), thanh nổi này chỉ che chart
  if (!showFavs || favorites.length === 0 || phone) return null;

  return (
    <div
      ref={barRef}
      className="absolute left-1/2 top-2 z-20 flex h-[38px] max-w-[calc(100%-16px)] select-none items-center overflow-x-auto rounded-md bg-[var(--panel)] px-1 shadow-[0_2px_4px_rgba(0,0,0,0.4)] [scrollbar-width:none]"
      style={{ transform: `translate(calc(-50% + ${shown.x}px), ${shown.y}px)` }}
    >
      <div
        className="mr-1 flex h-9 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-[var(--muted)] active:cursor-grabbing"
        onPointerDown={(e) => {
          e.preventDefault(); // không để kéo thanh thành bôi đen (select) chữ trên trang
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = {
            sx: e.clientX,
            sy: e.clientY,
            ox: shown.x,
            oy: shown.y,
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
          const parent = bar?.parentElement;
          if (!bar || !parent) return;
          const l = limits({ pw: parent.clientWidth, ph: parent.clientHeight, bw: bar.offsetWidth, bh: bar.offsetHeight });
          setPos({
            x: clamp(s.ox + e.clientX - s.sx, l.minX, Math.max(l.minX, l.maxX)),
            y: clamp(s.oy + e.clientY - s.sy, l.minY, Math.max(l.minY, l.maxY)),
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
            className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded ${tool === id ? "bg-[var(--hover)] text-[var(--accent-text)]" : "hover:bg-[var(--hover)]"}`}
          >
            <ToolIcon id={id} />
          </button>
        ))}
    </div>
  );
}
