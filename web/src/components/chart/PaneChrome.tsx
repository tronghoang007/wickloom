"use client";

import type { IChartApi } from "lightweight-charts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { IndicatorInstance } from "@/indicators/instance";
import { MAIN_PANE } from "@/indicators/layout";
import { paneAt, paneRects, squeezedHeights, squeezedPanes, type PaneRect } from "./panes";

/** Một pane indicator (không gồm pane chính): chỉ số pane LWC, khoá pane, các indicator trong pane theo thứ tự legend. */
export type PaneGroup = { index: number; key: string; insts: IndicatorInstance[] };

const sameRects = (a: PaneRect[], b: PaneRect[]) =>
  a.length === b.length && a.every((r, i) => Math.abs(r.top - b[i].top) < 0.5 && Math.abs(r.height - b[i].height) < 0.5);

// Icon lấy nguyên từ cụm nút pane của TV (lưới 15px)
const Ic = ({ children, stroke }: { children: ReactNode; stroke?: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill={stroke ? "none" : "currentColor"} stroke={stroke ? "currentColor" : undefined}>
    {children}
  </svg>
);
const UpIc = () => <Ic><path d="M11.83 6.12l-.66.76L8 4.1V12H7V4.1L3.83 6.88l-.66-.76L7.5 2.34l4.33 3.78z" /></Ic>;
const DownIc = () => <Ic><path d="M11.83 8.88l-.66-.76L8 10.9V3H7v7.9L3.83 8.12l-.66.76 4.33 3.78 4.33-3.78z" /></Ic>;
const DeleteIc = () => (
  <Ic>
    <path d="M6.5 2a.5.5 0 0 0-.5.5V3h3v-.5a.5.5 0 0 0-.5-.5h-2ZM10 3h3v1h-1.05l-.86 8.65A1.5 1.5 0 0 1 9.59 14H5.4a1.5 1.5 0 0 1-1.49-1.35L3.05 4H2V3h3v-.5C5 1.67 5.67 1 6.5 1h2c.83 0 1.5.67 1.5 1.5V3ZM4.05 4l.86 8.55a.5.5 0 0 0 .5.45H9.6a.5.5 0 0 0 .5-.45L10.94 4h-6.9Z" />
  </Ic>
);
const CollapseIc = () => <Ic stroke><path d="M11 2 7.5 5 4 2" /><path d="M4 13l3.5-3 3.5 3" /></Ic>;
const ExpandIc = () => <Ic stroke><path d="m4 5 3.5-3L11 5" /><path d="M11 10l-3.5 3L4 10" /></Ic>;
const MaximizeIc = () => (
  <Ic>
    <path d="M4.5 12A1.5 1.5 0 0 1 3 10.5V9H2v1.5A2.5 2.5 0 0 0 4.5 13h6a2.5 2.5 0 0 0 2.5-2.5V9h-1v1.5c0 .83-.67 1.5-1.5 1.5h-6z" />
    <path d="M4.5 3C3.67 3 3 3.67 3 4.5V6H2V4.5A2.5 2.5 0 0 1 4.5 2h6A2.5 2.5 0 0 1 13 4.5V6h-1V4.5c0-.83-.67-1.5-1.5-1.5h-6z" />
  </Ic>
);

// Nút như TV (đo): 24px, viền #464646, bo 4px; rê vào thì đảo màu (nền sáng, icon tối)
const btn =
  "flex h-6 w-6 items-center justify-center rounded border border-[#464646] bg-[var(--bg)] text-[var(--fg)] hover:bg-[var(--fg)] hover:text-[var(--bg)] disabled:cursor-default disabled:opacity-55 disabled:hover:bg-[var(--bg)] disabled:hover:text-[var(--fg)]";

/**
 * Phần "vỏ" của các pane như TV: legend của indicator (tên, tham số, giá trị, nút ẩn / Settings / gỡ) nằm ngay đầu pane của nó,
 * và khi rê vào pane hiện cụm nút ở góc phải. Nút nào không áp dụng thì ẩn (như TV): Move pane up / down, Delete pane, Collapse pane,
 * Maximize pane; pane chính chỉ có Move up / down và Maximize; pane đang phóng to chỉ còn Move up / down và Maximize (sáng).
 * Vị trí pane đo từ chính DOM của LWC; collapse / maximize chỉ đổi stretch factor các pane (pane bị ép phủ nền chart để ẩn nội dung).
 */
export default function PaneChrome({
  getChart,
  getBox,
  ver,
  groups,
  mainIndex,
  bg,
  renderLegend,
  onMove,
  onDelete,
  onMainSqueezed,
  onMainTop,
  mainLegendHover,
  buttons = true,
}: {
  getChart: () => IChartApi | null;
  getBox: () => HTMLElement | null;
  ver: number; // đổi khi indicator tính lại / dựng lại -> đo lại vị trí pane
  groups: PaneGroup[]; // các pane riêng của indicator (không gồm pane chính)
  mainIndex: number; // chỉ số pane chính giữa các pane
  bg: string;
  renderLegend: (inst: IndicatorInstance) => ReactNode;
  onMove: (key: string, dir: -1 | 1) => void; // key = MAIN_PANE cho pane chính
  onDelete: (key: string) => void;
  /** Pane chính đang bị ép thấp (một pane khác phóng to): legend chính chỉ nên giữ hàng tiêu đề. */
  onMainSqueezed: (squeezed: boolean) => void;
  /** Mép trên pane chính trong khung chart: legend chính đi theo. */
  onMainTop: (top: number) => void;
  /** Con trỏ đang ở legend của pane chính (legend đó do Chart vẽ): hiện cụm nút của pane chính như khi rê vào pane. */
  mainLegendHover: boolean;
  /** false (phone dọc, user 10-29): không có cụm nút Move / Delete / Collapse / Maximize của pane, chart cho gọn. */
  buttons?: boolean;
}) {
  const [rects, setRects] = useState<PaneRect[]>([]);
  const [priceW, setPriceW] = useState(70);
  const [hover, setHover] = useState<number | null>(null); // pane dưới con trỏ
  const [onCover, setOnCover] = useState<number | null>(null); // con trỏ đang ở nút / nền phủ của pane
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [maxi, setMaxi] = useState<string | null>(null);
  const saved = useRef<number[] | null>(null); // stretch factor trước khi bị ép, để trả lại
  const rectsRef = useRef<PaneRect[]>([]); // vị trí pane mới nhất, cho callback chuột (không phụ thuộc render)

  // mọi pane theo chỉ số: pane chính + các pane riêng
  const entries = [{ key: MAIN_PANE, index: mainIndex, insts: [] as IndicatorInstance[] }, ...groups];
  const total = entries.length;
  const keys = entries.map((g) => g.key);
  const keySig = `${keys.join("|")}@${mainIndex}`;
  // trạng thái của pane đã bị gỡ thì bỏ qua (không cần xoá khỏi state); chỉ còn pane chính thì không có gì để thu / phóng
  const alone = groups.length === 0;
  const collapsedKeys = alone ? [] : collapsed.filter((k) => keys.includes(k));
  const maxiKey = !alone && maxi !== null && keys.includes(maxi) ? maxi : null;
  const indexOf = (key: string) => entries.find((g) => g.key === key)?.index ?? -1;
  const paneCount = rects.length;
  const squeezed = squeezedPanes(paneCount, collapsedKeys.map(indexOf), maxiKey === null ? null : indexOf(maxiKey));
  const squeezeSig = [...squeezed].sort().join(",");
  const mainSqueezed = squeezed.has(mainIndex);
  useEffect(() => {
    onMainSqueezed(mainSqueezed);
  }, [mainSqueezed, onMainSqueezed]);
  const mainTop = rects[mainIndex]?.top ?? 0;
  useEffect(() => {
    onMainTop(mainTop);
  }, [mainTop, onMainTop]);

  // vị trí pane: đo lại khi khung / pane đổi cỡ (kéo đường ngăn) và mỗi lần indicator dựng lại
  useEffect(() => {
    const chart = getChart();
    const box = getBox();
    if (!chart || !box) return;
    const measure = () => {
      const r = paneRects(chart, box);
      rectsRef.current = r;
      setRects((p) => (sameRects(p, r) ? p : r));
      setPriceW(chart.priceScale("right", mainIndex).width());
    };
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    for (const p of chart.panes()) {
      const el = p.getHTMLElement();
      if (el) ro.observe(el);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [getChart, getBox, ver, mainIndex]);

  // pane dưới con trỏ: toạ độ y của sự kiện crosshair LWC tính theo từng pane nên không dùng được, đo từ con trỏ trên khung chart
  useEffect(() => {
    const box = getBox();
    if (!box) return;
    const move = (e: PointerEvent) => {
      const i = paneAt(rectsRef.current, e.clientY - box.getBoundingClientRect().top);
      setHover(i >= 0 ? i : null);
    };
    // ngón tay: nhấc lên cũng là rời khung (pointerleave) nên nút của pane vừa chạm phải giữ lại tới lần chạm pane khác
    const leave = (e: PointerEvent) => {
      if (e.pointerType !== "touch") setHover(null);
    };
    box.addEventListener("pointerdown", move);
    box.addEventListener("pointermove", move);
    box.addEventListener("pointerleave", leave);
    return () => {
      box.removeEventListener("pointerdown", move);
      box.removeEventListener("pointermove", move);
      box.removeEventListener("pointerleave", leave);
    };
  }, [getBox, ver]);

  // ép / trả chiều cao pane
  useEffect(() => {
    const chart = getChart();
    if (!chart) return;
    const panes = chart.panes();
    if (saved.current && saved.current.length !== panes.length) saved.current = null; // số pane đổi: bỏ ảnh chụp cũ
    const sq = new Set(squeezeSig ? squeezeSig.split(",").map(Number) : []);
    if (sq.size === 0) {
      if (saved.current) panes.forEach((p, i) => p.setStretchFactor(saved.current![i]));
      saved.current = null;
      return;
    }
    const weights = (saved.current ??= panes.map((p) => p.getStretchFactor()));
    const sum = panes.reduce((s, p) => s + p.getHeight(), 0);
    const px = weights.reduce((s, w) => s + w, 0) / (sum || 1); // stretch factor trên mỗi px
    squeezedHeights(sum, weights, sq).forEach((h, i) => panes[i].setStretchFactor(h * px));
  }, [getChart, squeezeSig, paneCount, keySig]);

  // đổi chỗ pane: thứ tự đổi thì ảnh chụp stretch factor theo chỉ số cũ không còn đúng -> trả pane về như cũ trước đã
  const move = (key: string, dir: -1 | 1) => {
    setCollapsed([]);
    setMaxi(null);
    onMove(key, dir);
  };

  if (!rects.length || alone) return null;
  const covers = [...squeezed].filter((i) => rects[i]);
  return (
    <>
      {covers.map((i) => (
        <div
          key={`cover-${i}`}
          className="absolute inset-x-0 z-[9]"
          style={{ top: rects[i].top, height: rects[i].height, background: bg }}
          onMouseEnter={() => setOnCover(i)}
          onMouseLeave={() => setOnCover(null)}
        />
      ))}
      {entries.map((g) => {
        const r = rects[g.index];
        if (!r) return null;
        const isMain = g.key === MAIN_PANE;
        const isCollapsed = collapsedKeys.includes(g.key);
        const isMaxi = maxiKey === g.key;
        const show = buttons && (hover === g.index || onCover === g.index || (isMain && mainLegendHover));
        return (
          <div key={g.key}>
            {g.insts.length > 0 && (
              <div
                className="pointer-events-none absolute left-3 z-10 text-[13px] leading-[20px]"
                style={{ top: r.top + 6, "--legend-bg": `color-mix(in srgb, ${bg} 50%, transparent)` } as React.CSSProperties}
                // legend nằm đè lên chart nên chuột ở trên nó không còn được tính là "trong pane": rê vào tiêu đề cũng hiện cụm nút
                onMouseEnter={() => setOnCover(g.index)}
                onMouseLeave={() => setOnCover(null)}
              >
                {g.insts.map((inst) => (
                  <div key={inst.uid}>{renderLegend(inst)}</div>
                ))}
              </div>
            )}
            <div
              className={`absolute z-10 gap-1 ${show ? "flex" : "hidden"}`}
              style={{ top: r.top + 4, right: priceW + 8 }}
              onMouseEnter={() => setOnCover(g.index)}
              onMouseLeave={() => setOnCover(null)}
            >
              {g.index > 0 && (
                <button type="button" className={btn} title="Move pane up" aria-label="Move pane up" onClick={() => move(g.key, -1)}>
                  <UpIc />
                </button>
              )}
              {g.index < total - 1 && (
                <button type="button" className={btn} title="Move pane down" aria-label="Move pane down" onClick={() => move(g.key, 1)}>
                  <DownIc />
                </button>
              )}
              {/* Như TV: pane đang phóng to chỉ còn Move up / Move down / Maximize (nút sáng = đang bật); pane chính không xoá / thu gọn được */}
              {!isMain && !isMaxi && (
                <>
                  <button type="button" className={btn} title="Delete pane" aria-label="Delete pane" onClick={() => onDelete(g.key)}>
                    <DeleteIc />
                  </button>
                  <button
                    type="button"
                    className={btn}
                    title={isCollapsed ? "Restore pane" : "Collapse pane"}
                    aria-label={isCollapsed ? "Restore pane" : "Collapse pane"}
                    onClick={() => {
                      setMaxi(null);
                      setCollapsed((c) => (isCollapsed ? c.filter((k) => k !== g.key) : [...c, g.key]));
                    }}
                  >
                    {isCollapsed ? <ExpandIc /> : <CollapseIc />}
                  </button>
                </>
              )}
              <button
                type="button"
                className={`${btn}${isMaxi ? " !bg-[var(--fg)] !text-[var(--bg)]" : ""}`}
                title={isMaxi ? "Restore pane" : "Maximize pane"}
                aria-label={isMaxi ? "Restore pane" : "Maximize pane"}
                onClick={() => {
                  setCollapsed([]);
                  setMaxi(isMaxi ? null : g.key);
                }}
              >
                <MaximizeIc />
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
