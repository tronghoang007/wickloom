"use client";

import { LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type SeriesType } from "lightweight-charts";
import { drawingGlobal } from "@/drawings/store";
import { useAuthStore } from "@/store/auth";
import { useMt5Store } from "@/store/mt5";
import { canModifyTrades, makeStopTitle } from "@/trading/chartOrders";
import { draftLines } from "@/trading/draft";
import { tradeLines, type DragPreview, type LineSpec, type TagOwner } from "@/trading/format";
import { useQuoteStore } from "@/trading/quote";
import { useTradeStore } from "@/trading/store";
import { closeFromTag, placeFromTag } from "@/trading/tagActions";
import { useTicketStore } from "@/trading/ticket";
import { useEffect, useMemo, useRef, useState } from "react";

const TAG_H = 22;
const RIGHT_GAP = 70; // thẻ nằm lệch trái khỏi mép vùng vẽ (giống TV: "Order and position alignment: Right")
const LINK_X = 34; // đường nối dọc giữa giá vào / SL / TP cách mép vùng vẽ

const STYLE = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted } as const;
const OWNER_ID = (o: TagOwner) => (o.t === "draft" ? "draft" : `${o.t}:${o.ticket}`);
const KIND_NAME = { sl: "SL", tp: "TP" } as const;

function useNowSec() {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

type Props = {
  symbol: string;
  chartType: string; // đổi loại nến thì series mới: đường giá cũ mất theo series cũ
  replay: boolean;
  preview: DragPreview | null;
  getChart: () => IChartApi | null;
  getSeries: () => ISeriesApi<SeriesType> | null;
  getDigits: () => number;
  onGhost: (owner: TagOwner, kind: "sl" | "tp", e: PointerEvent) => void;
  onConfirmEdit: () => void; // ✓ trên thẻ đang chờ xác nhận sau khi kéo
  onCancelEdit: () => void;
};

/** Vị thế, lệnh chờ và bản nháp lệnh trên chart kiểu TradingView (docs/trade-plan.md T3-T4): đường giá (price line: nền liền cho lệnh đã đặt, nét đứt cho bản nháp, chấm cho SL/TP)
 *  cùng các thẻ DOM nằm trên đường: [Buy/Sell của bản nháp] [TP+] [SL+] [lot | loại lệnh hoặc lãi/lỗi | ×], và đường nối dọc giữa giá vào với SL/TP. Kéo thẻ = kéo đường (LineDrag
 *  nhận ra thẻ qua `data-line-key`); kéo nút TP/SL mờ ra giá cần đặt để tạo mới. Vị trí cập nhật mỗi khung hình vì chart không báo khi trục giá đổi. */
export default function TradeOverlay({ symbol, chartType, replay, preview, getChart, getSeries, getDigits, onGhost, onConfirmEdit, onCancelEdit }: Props) {
  const tradeData = useTradeStore((s) => s.data);
  const draft = useTicketStore((s) => s.draft);
  const quote = useQuoteStore((s) => s.quotes[symbol]);
  const account = useMt5Store((s) => s.accounts.find((a) => a.active));
  const status = useAuthStore((s) => s.status);
  const tool = drawingGlobal((s) => s.tool);
  const now = useNowSec();
  const ccy = account?.currency ?? "";

  const lines = useMemo<LineSpec[]>(
    () => (replay ? [] : [...tradeLines(tradeData, symbol, now, preview, makeStopTitle(), ccy), ...draftLines(draft, symbol, quote, makeStopTitle())]),
    [replay, tradeData, symbol, now, preview, ccy, draft, quote],
  );
  // chủ (vị thế / lệnh chờ) đang có thay đổi chờ xác nhận: thẻ giá vào của nó hiện Discard / Confirm
  const pendingOwners = useMemo(() => new Set(lines.filter((l) => l.tag?.pending).map((l) => OWNER_ID((l.tag as NonNullable<LineSpec["tag"]>).owner))), [lines]);
  // đọc lại store mỗi lần render: account / đăng nhập đổi thì render lại (đã đăng ký ở trên)
  const modify = status === "user" && account !== undefined && canModifyTrades();

  // --- vẽ đường giá và đặt vị trí thẻ, mỗi khung hình ---
  const root = useRef<HTMLDivElement>(null);
  const link = useRef<SVGSVGElement>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  const linesRef = useRef<LineSpec[]>([]);
  const dirty = useRef(true);
  useEffect(() => {
    linesRef.current = lines;
    dirty.current = true;
  }, [lines, chartType]);

  useEffect(() => {
    let raf = 0;
    let synced: ISeriesApi<SeriesType> | null = null;
    let priceLines = new Map<string, IPriceLine>();
    let lastLink = "";
    const placed = new Map<string, string>(); // khoá thẻ → "right|y" đã ghi, tránh ghi lại DOM khi không đổi

    const syncPriceLines = (series: ISeriesApi<SeriesType>) => {
      if (synced !== series) {
        synced = series; // series mới (đổi loại nến): price line cũ đã mất cùng series cũ
        priceLines = new Map();
      }
      const want = linesRef.current;
      const keep = new Set(want.map((w) => w.key));
      for (const [k, l] of priceLines) {
        if (!keep.has(k)) {
          series.removePriceLine(l);
          priceLines.delete(k);
        }
      }
      for (const w of want) {
        const opts = { price: w.price, color: w.color, lineWidth: 1 as const, lineStyle: STYLE[w.style], axisLabelVisible: true, title: w.tag ? "" : w.title };
        const cur = priceLines.get(w.key);
        if (cur) cur.applyOptions(opts);
        else priceLines.set(w.key, series.createPriceLine(opts));
      }
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const chart = getChart();
      const series = getSeries();
      const box = root.current;
      if (!chart || !series || !box) return;
      if (dirty.current || synced !== series) {
        dirty.current = false;
        syncPriceLines(series);
      }
      const wantLines = linesRef.current;
      if (wantLines.length === 0 && els.current.size === 0 && lastLink === "") return; // không có gì để vẽ: khỏi đo layout mỗi khung hình
      const h = box.clientHeight;
      const right = box.clientWidth - chart.timeScale().width() + RIGHT_GAP;
      const linkX = chart.timeScale().width() - LINK_X;
      const ys = new Map<string, number>();
      for (const l of wantLines) {
        const y = series.priceToCoordinate(l.price);
        if (y !== null) ys.set(l.key, y as number);
      }
      for (const [key, el] of els.current) {
        const y = ys.get(key);
        const visible = y !== undefined && y >= -TAG_H && y <= h + TAG_H;
        const sig = visible ? `${right}|${Math.round(y)}` : "";
        if (placed.get(key) === sig) continue;
        placed.set(key, sig);
        if (!visible) {
          el.style.display = "none";
        } else {
          el.style.display = "flex";
          el.style.right = `${right}px`;
          el.style.transform = `translateY(${Math.round(y) - TAG_H / 2}px)`;
        }
      }
      // đường nối dọc: mỗi chủ (bản nháp / vị thế / lệnh) có từ hai đường trở lên thì nối từ giá vào tới SL / TP
      let svg = "";
      const groups = new Map<string, LineSpec[]>();
      for (const l of wantLines) if (l.tag && ys.has(l.key)) groups.set(OWNER_ID(l.tag.owner), [...(groups.get(OWNER_ID(l.tag.owner)) ?? []), l]);
      for (const g of groups.values()) {
        if (g.length < 2) continue;
        const entry = g.find((l) => l.tag?.kind === "entry") ?? g[0];
        const op = entry.tag?.draft ? 0.6 : 0.9;
        const gy = g.map((l) => ys.get(l.key) as number);
        svg += `<line x1="${linkX}" x2="${linkX}" y1="${Math.min(...gy)}" y2="${Math.max(...gy)}" stroke="${entry.color}" stroke-width="1" stroke-dasharray="4 3" opacity="${op}"/>`;
        for (const l of g) {
          const filled = l === entry;
          svg += `<circle cx="${linkX}" cy="${ys.get(l.key)}" r="3.5" fill="${filled ? l.color : "var(--bg)"}" stroke="${l.color}" stroke-width="1.5" opacity="${op}"/>`;
        }
      }
      if (svg !== lastLink && link.current) {
        lastLink = svg;
        link.current.innerHTML = svg;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      const series = synced;
      if (series) for (const l of priceLines.values()) series.removePriceLine(l);
    };
  }, [getChart, getSeries]);

  const events = tool ? "pointer-events-none" : "pointer-events-auto";
  const bg = "color-mix(in srgb, var(--bg) 88%, transparent)";
  const digits = getDigits();

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" data-testid="trade-overlay">
      <svg ref={link} className="absolute inset-0 h-full w-full" aria-hidden />
      {lines.flatMap((l) => {
        const tag = l.tag;
        if (!tag) return [];
        const live = tag.draft || modify; // đã đặt thì cần được phép sửa: guest / real / EA tắt chỉ xem
        const c = l.color;
        const fade = tag.pending ? 0.55 : tag.draft && tag.kind !== "entry" ? 0.75 : tag.draft ? 0.9 : 1; // thẻ đang sửa chờ xác nhận mờ đi như TV
        const closeTitle = tag.kind !== "entry" ? `Bỏ ${KIND_NAME[tag.kind]}` : tag.owner.t === "draft" ? "Bỏ bản nháp" : tag.owner.t === "order" ? "Huỷ lệnh chờ" : "Đóng vị thế";
        return [
          <div
            key={l.key}
            ref={(el) => {
              if (el) els.current.set(l.key, el);
              else els.current.delete(l.key);
            }}
            data-testid="trade-tag"
            data-tag={l.key}
            className="absolute left-auto top-0 hidden select-none items-center gap-1 text-[12px] font-medium leading-none"
            style={{ height: TAG_H, opacity: fade }}
          >
            {tag.kind === "entry" && live && pendingOwners.has(OWNER_ID(tag.owner)) && (
              <>
                <button
                  type="button"
                  data-tag-btn
                  title="Bỏ thay đổi (Esc)"
                  onClick={onCancelEdit}
                  className={`${events} cursor-pointer rounded border border-[var(--fg)]/50 px-2.5 text-[12px] font-medium hover:bg-white/10`}
                  style={{ height: TAG_H, background: bg, color: "var(--fg)" }}
                >
                  Discard
                </button>
                <button
                  type="button"
                  data-tag-btn
                  title="Áp dụng thay đổi"
                  onClick={onConfirmEdit}
                  className={`${events} cursor-pointer rounded px-2.5 text-[12px] font-semibold text-white hover:brightness-110`}
                  style={{ height: TAG_H, background: "#2962ff" }}
                >
                  Confirm
                </button>
              </>
            )}
            {live &&
              tag.ghosts.map((k) => (
                <button
                  key={k}
                  type="button"
                  data-tag-btn
                  title={`Kéo để đặt ${KIND_NAME[k]}`}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onGhost(tag.owner, k, e.nativeEvent);
                  }}
                  className={`${events} cursor-pointer rounded border border-dotted px-2 font-semibold opacity-70 hover:opacity-100`}
                  style={{ height: TAG_H, color: k === "tp" ? "#089981" : "#ff9800", borderColor: k === "tp" ? "#089981" : "#ff9800", background: bg }}
                >
                  {KIND_NAME[k]}
                </button>
              ))}
            <div
              data-line-key={live ? l.key : undefined}
              className={`${events} flex items-stretch overflow-hidden rounded border tabular-nums ${live ? "cursor-pointer" : ""}`}
              style={{ height: TAG_H, color: c, borderColor: c, background: bg }}
            >
              <span className="flex items-center border-r px-2" style={{ borderColor: c }}>
                {tag.qty}
              </span>
              <span className="flex min-w-[52px] items-center justify-center whitespace-nowrap px-2.5" style={{ borderColor: c }}>
                {tag.label}
              </span>
              {live && !tag.pending && (
                <button
                  type="button"
                  data-tag-btn
                  title={closeTitle}
                  aria-label={closeTitle}
                  onClick={() => closeFromTag(l, symbol, digits)}
                  className="flex w-6 cursor-pointer items-center justify-center border-l text-[15px] hover:bg-white/10"
                  style={{ borderColor: c }}
                >
                  ×
                </button>
              )}
            </div>
            {tag.place && (
              <button
                type="button"
                data-tag-btn
                title={tag.label === "Market" ? `${tag.place} market` : `Đặt ${tag.label}`}
                onClick={placeFromTag}
                className={`${events} ml-2 cursor-pointer rounded px-3 text-[12px] font-semibold text-white hover:brightness-110`}
                style={{ height: TAG_H, background: c }}
              >
                {tag.place}
              </button>
            )}
          </div>,
        ];
      })}
    </div>
  );
}
