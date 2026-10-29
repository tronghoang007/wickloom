"use client";

import { byId } from "@/indicators/catalog";
import { useIndicatorStore } from "@/indicators/store";
import { useChartStore } from "@/store/chart";
import { useVolumeStore } from "@/store/volume";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Close, DotsI, Eye, IndicatorsI } from "../icons";

// Khung trên vòng như MT5 mobile; khung khác (M2, M3, M10, H2, H3) chọn ở lưới đầy đủ (nút ⋯)
const RING_TFS = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN1"];
const ringLabel = (tf: string) => (tf === "MN1" ? "MN" : tf);

const GridI = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <rect x="14" y="14" width="6" height="6" rx="1" />
  </svg>
);

/** Vòng chọn khung thời gian của phone, như vòng của MT5 mobile (user gửi ảnh 10-29): nổi giữa màn, các khung quanh vòng (M1 trên bên trái, xoay theo chiều
 *  kim đồng hồ), bên trái là lưới đủ khung, Indicators (danh sách indicator đang có trên chart, bật tắt ẩn / hiện — legend của phone dọc không còn hàng indicator)
 *  và ⋯ (`more`: menu ⋯ cũ của thanh trên, hiện thành popup ngay dưới thanh). Chạm ngoài vòng (cả lỗ giữa) thì đóng.
 *  `at` (toạ độ viewport): mở bằng chạm chart thì tâm vòng ở chỗ chạm (dời vào trong nếu tràn màn), không có thì giữa màn; mở ra có xoay vào như MT5. */
export default function TimeframeRing({ onClose, onGrid, more, at }: { onClose: () => void; onGrid: () => void; more: ReactNode; at?: { x: number; y: number } | null }) {
  const tf = useChartStore((s) => s.tf);
  const set = useChartStore((s) => s.set);
  const [view, setView] = useState<"ring" | "list" | "more">("ring");
  const items: { key: string; label: React.ReactNode; aria: string; on?: boolean; run: () => void }[] = [
    ...RING_TFS.map((t) => ({ key: t, label: ringLabel(t), aria: t, on: t === tf, run: () => (set({ tf: t }), onClose()) })),
    { key: "grid", label: <GridI />, aria: "All timeframes", run: onGrid },
    { key: "ind", label: <IndicatorsI />, aria: "Indicator list", run: () => setView("list") },
    { key: "more", label: <DotsI />, aria: "More", run: () => setView("more") },
  ];
  const step = 360 / items.length;
  const ring = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ring.current?.animate(
      [
        { transform: "rotate(-150deg) scale(0.4)", opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 280, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  }, [view]);
  // cỡ và chỗ đặt: tâm ở `at`, kẹp trong màn chừa thanh trên (56px) và tab bar (64px)
  const W = window.innerWidth;
  const H = window.innerHeight;
  const D = Math.min(300, W * 0.82, H * 0.82);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const left = clamp((at?.x ?? W / 2) - D / 2, 8, W - D - 8);
  const top = clamp((at?.y ?? H / 2) - D / 2, Math.min(56, (H - D) / 2), Math.max(H - D - 64, (H - D) / 2));
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      {view === "more" && (
        // như popup của nút ⋯ cũ: ngay dưới thanh trên, sát mép phải (popup Layout bên trong canh mép phải nút của nó)
        <div role="menu" aria-label="More" className="fixed right-2 top-[calc(env(safe-area-inset-top)+52px)] z-40 flex w-[min(300px,calc(100vw-16px))] flex-col rounded-lg popup py-1">
          {more}
        </div>
      )}
      {view === "list" && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
          <IndicatorList onBack={() => setView("ring")} onClose={onClose} />
        </div>
      )}
      {view === "ring" && (
        <div ref={ring} role="dialog" aria-label="Timeframe" className="pointer-events-none fixed z-40" style={{ left, top, width: D, height: D }}>
          {/* vòng = nét tròn dày của SVG: lỗ giữa trong suốt, thấy chart như MT5 */}
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
            <circle cx="50" cy="50" r="37.5" fill="none" stroke="var(--panel)" strokeWidth="25" />
          </svg>
          {items.map((it, i) => {
            const a = ((i * step - 2 * step) * Math.PI) / 180; // M1 ở trên bên trái (hai nấc trước đỉnh), M15 ở đỉnh như MT5
            return (
              <button
                key={it.key}
                type="button"
                aria-label={it.aria}
                aria-pressed={it.on}
                onClick={it.run}
                className={`pointer-events-auto absolute flex h-[17%] w-[17%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[15px] font-semibold ${
                  it.on ? "bg-[var(--accent)] text-white" : "text-[var(--fg)] active:bg-[var(--hover)]"
                }`}
                style={{ left: `${50 + 37.5 * Math.sin(a)}%`, top: `${50 - 37.5 * Math.cos(a)}%` }}
              >
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Danh sách indicator của chart đang active (Volume + các indicator đã thêm): chạm mắt để ẩn / hiện. Thêm / gỡ indicator vẫn ở nút Indicators trên thanh trên. */
function IndicatorList({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const list = useIndicatorStore((s) => s.list);
  const update = useIndicatorStore((s) => s.update);
  const vol = useVolumeStore((s) => s.s);
  const setVol = useVolumeStore((s) => s.set);
  const row = "flex h-12 w-full items-center gap-3 px-4 text-left text-[15px]";
  const eye = (hidden: boolean) => (
    <span className={`ml-auto flex ${hidden ? "text-[var(--muted)]" : "text-[var(--fg)]"}`}>
      <Eye off={hidden} />
    </span>
  );
  return (
    <div role="dialog" aria-label="Indicator list" className="pointer-events-auto w-[min(320px,calc(100vw-32px))] overflow-hidden rounded-xl popup">
      <div className="flex h-12 items-center border-b border-[var(--border)] pl-2 pr-1">
        <button type="button" className="flex h-10 items-center px-2 text-[var(--accent-text)]" onClick={onBack}>
          ‹ Khung
        </button>
        <span className="flex-1 text-center text-[15px] font-semibold">Indicators</span>
        <button type="button" aria-label="Close" className="flex h-10 w-10 items-center justify-center" onClick={onClose}>
          <Close size={22} />
        </button>
      </div>
      <div className="max-h-[60dvh] overflow-y-auto py-1">
        {!vol.removed && (
          <button type="button" aria-pressed={!vol.hidden} className={row} onClick={() => setVol({ hidden: !vol.hidden })}>
            <span className={vol.hidden ? "text-[var(--muted)]" : ""}>Volume</span>
            {eye(vol.hidden)}
          </button>
        )}
        {list.map((inst) => (
          <button key={inst.uid} type="button" aria-pressed={!inst.hidden} className={row} onClick={() => update(inst.uid, { hidden: inst.hidden ? undefined : true })}>
            <span className={`min-w-0 truncate ${inst.hidden ? "text-[var(--muted)]" : ""}`}>{byId(inst.id).name}</span>
            {eye(!!inst.hidden)}
          </button>
        ))}
        {vol.removed && list.length === 0 && <div className="px-4 py-3 text-sm text-[var(--muted)]">Chưa có indicator — thêm ở nút Indicators trên thanh trên.</div>}
      </div>
    </div>
  );
}
