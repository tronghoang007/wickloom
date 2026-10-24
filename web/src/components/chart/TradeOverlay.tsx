"use client";

import { LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type SeriesType } from "lightweight-charts";
import { drawingGlobal } from "@/drawings/store";
import { useAuthStore } from "@/store/auth";
import { useMt5Store } from "@/store/mt5";
import { canModifyTrades, makeStopTitle } from "@/trading/chartOrders";
import { chartGlobal } from "@/store/chart";
import { draftLines } from "@/trading/draft";
import { useTradeFocus, withAlpha } from "@/trading/focus";
import { HANDLE_INSET } from "@/trading/lineDrag";
import { COLORS, fmtLot, fmtPnl, ghostsFor, tradeLines, type DragPreview, type LineSpec, type TagOwner } from "@/trading/format";
import { estimatePnl, pnlSpec } from "@/trading/pnl";
import { useQuoteStore } from "@/trading/quote";
import { openPnl, useReplaySim } from "@/trading/replaySim";
import { useTradeStore } from "@/trading/store";
import { closeFromTag, placeFromTag } from "@/trading/tagActions";
import { useTicketStore } from "@/trading/ticket";
import { useEffect, useMemo, useRef, useState } from "react";

const TAG_H = 22;
const RIGHT_GAP = 70; // thẻ nằm lệch trái khỏi mép vùng vẽ (giống TV: "Order and position alignment: Right")
const LINK_X = HANDLE_INSET; // đường nối dọc + chấm tròn trên mỗi đường, cách mép vùng vẽ (LineDrag đổi con trỏ thành lên-xuống đúng chỗ này)

const STYLE = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted } as const;
const OWNER_ID = (o: TagOwner) => (o.t === "draft" ? "draft" : `${o.t}:${o.ticket}`);
/** Dấu × trên thẻ vị thế giả lập: thẻ giá vào = Flatten (chốt ở giá nến replay hiện tại); thẻ SL / TP = bỏ mức đó. */
function closeSim(paneId: string, kind: "entry" | "sl" | "tp", sym: Parameters<typeof pnlSpec>[0], ccy: string) {
  if (kind !== "entry") {
    useReplaySim.getState().setStop(paneId, kind, 0);
    return;
  }
  const spec = pnlSpec(sym, ccy || "USD");
  if (spec) useReplaySim.getState().flatten(paneId, spec);
}

const KIND_NAME = { sl: "SL", tp: "TP" } as const;
const KIND_FULL = { sl: "Stop loss", tp: "Take profit" } as const; // chữ của tooltip nút TP / SL mờ (như TradingView)
const SIM_TICKET = -1; // vị thế giả lập của Replay (không phải lệnh thật)
const PNL_UP = "#089981"; // số lãi / lỗ trên thẻ (nhãn bắt đầu bằng + / -) tô xanh / đỏ theo dấu, không theo màu đường
const PNL_DOWN = "#f23645";
const DIM = 0.5; // độ đục của lệnh không được focus (0.3 làm chữ thẻ chỉ còn ~1.7:1, không đọc được)
// chữ thẻ pha 25% về phía --fg: #2962ff (lệnh Buy) trên nền tối chỉ đạt 3.4-3.9:1; viền và nút vẫn giữ nguyên màu đường
const tagText = (c: string) => `color-mix(in srgb, ${c}, var(--fg) 25%)`;
const ownerName = (o: TagOwner) => (o.t === "draft" ? "Bản nháp" : `${o.t === "order" ? "Lệnh chờ" : "Vị thế"} #${o.ticket}`);

function useNowSec() {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

type Props = {
  paneId: string; // vị thế giả lập của Replay (trading/replaySim.ts) thuộc về pane này
  symbol: string;
  chartType: string; // đổi loại nến thì series mới: đường giá cũ mất theo series cũ
  replay: boolean;
  preview: DragPreview[]; // đường đang kéo / chờ xác nhận / vừa gửi
  getChart: () => IChartApi | null;
  getSeries: () => ISeriesApi<SeriesType> | null;
  getMainRect: () => { top: number; height: number }; // pane chính trong khung chart: toạ độ y của series là theo pane đó, pane chính có thể không nằm trên cùng
  getDigits: () => number;
  onGhost: (owner: TagOwner, kind: "sl" | "tp", e: PointerEvent) => void;
  onConfirmEdit: (owner: string) => void; // Confirm / Discard trên thẻ giá vào của chủ (vị thế / lệnh) có thay đổi chờ xác nhận sau khi kéo; owner = OWNER_ID
  onCancelEdit: (owner: string) => void;
};

/** Vị thế, lệnh chờ và bản nháp lệnh trên chart kiểu TradingView (docs/trade-plan.md T3-T4): đường giá (price line: nền liền cho lệnh đã đặt, nét đứt cho bản nháp, chấm cho SL/TP)
 *  cùng các thẻ DOM nằm trên đường: [Buy/Sell của bản nháp] [TP+] [SL+] [lot | loại lệnh hoặc lãi/lỗi | ×], và đường nối dọc giữa giá vào với SL/TP. Kéo thẻ = kéo đường (LineDrag
 *  nhận ra thẻ qua `data-line-key`); kéo nút TP/SL mờ ra giá cần đặt để tạo mới. Vị trí cập nhật mỗi khung hình vì chart không báo khi trục giá đổi. */
export default function TradeOverlay({ paneId, symbol, chartType, replay, preview, getChart, getSeries, getMainRect, getDigits, onGhost, onConfirmEdit, onCancelEdit }: Props) {
  const tradeData = useTradeStore((s) => s.data);
  const draft = useTicketStore((s) => s.draft);
  const quote = useQuoteStore((s) => s.quotes[symbol]);
  const account = useMt5Store((s) => s.accounts.find((a) => a.active));
  const status = useAuthStore((s) => s.status);
  const tool = drawingGlobal((s) => s.tool);
  const now = useNowSec();
  const ccy = account?.currency ?? "";

  // Đang Replay: đường thật ẩn, chỉ hiện vị thế GIẢ LẬP của Replay (một đường giá vào, thẻ [lot | lãi/lỗi | ×]; × = Flatten). Ticket âm = vị thế giả lập.
  const sim = useReplaySim((s) => s.byPane[paneId]);
  const symInfo = chartGlobal((s) => s.symbols.find((x) => x.name === symbol));
  const lines = useMemo<LineSpec[]>(() => {
    if (!replay) return [...tradeLines(tradeData, symbol, now, preview, makeStopTitle(), ccy), ...draftLines(draft, symbol, quote, makeStopTitle())];
    const p = sim?.position;
    if (!sim || !p || sim.symbol !== symbol) return [];
    const spec = pnlSpec(symInfo, ccy || "USD");
    const money = (v: number | null) => (v === null ? "—" : `${fmtPnl(v)} ${ccy || "USD"}`);
    const label = money(openPnl(sim, spec));
    const owner: TagOwner = { t: "position", ticket: SIM_TICKET };
    const stop = (kind: "sl" | "tp", price: number): LineSpec[] =>
      price > 0
        ? [{ key: `s${kind}:${SIM_TICKET}`, price, color: kind === "sl" ? COLORS.sl : COLORS.tp, style: "dotted", title: `${KIND_NAME[kind]} ${money(spec ? estimatePnl(p.side, p.lot, p.entry, price, spec) : null)}`,
            tag: { kind, owner, qty: fmtLot(p.lot), label: money(spec ? estimatePnl(p.side, p.lot, p.entry, price, spec) : null), ghosts: [], draft: false } }]
        : [];
    return [
      {
        key: "sim:pos",
        price: p.entry,
        color: p.side === "buy" ? COLORS.buy : COLORS.sell,
        style: "solid",
        title: `${p.side.toUpperCase()} ${fmtLot(p.lot)} ${label}`,
        tag: { kind: "entry", owner, qty: fmtLot(p.lot), label, ghosts: ghostsFor(p.sl, p.tp), draft: false },
      },
      ...stop("sl", p.sl),
      ...stop("tp", p.tp),
    ];
  }, [replay, tradeData, symbol, now, preview, ccy, draft, quote, sim, symInfo]);
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

  // lệnh đang focus (nếu còn trên chart): các lệnh khác mờ, đường nối của lệnh này đậm
  const focusOwner = useTradeFocus((s) => s.owner);
  const focus = focusOwner !== null && lines.some((l) => l.tag && OWNER_ID(l.tag.owner) === focusOwner) ? focusOwner : null;
  const focusRef = useRef<string | null>(null);
  useEffect(() => {
    focusRef.current = focus;
    dirty.current = true;
  }, [focus]);

  // Trỏ vào nút TP / SL mờ: tô nhạt cả vùng chart phía lãi (TP) hoặc phía lỗi (SL) so với đường giá vào, như TradingView. Đọc mỗi khung hình nên không cần render lại
  const zoneRef = useRef<{ key: string; up: boolean; color: string } | null>(null);
  const zoneEl = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<string | null>(null); // chủ của thẻ đang được trỏ vào: đọc mỗi khung hình nên không cần render lại
  useEffect(() => {
    let raf = 0;
    let synced: ISeriesApi<SeriesType> | null = null;
    let priceLines = new Map<string, IPriceLine>();
    let lastLink = "";
    let placedAt = ""; // vị trí pane chính đã áp cho lớp phủ
    const placed = new WeakMap<HTMLDivElement, string>(); // phần tử thẻ → "right|y" đã ghi, tránh ghi lại DOM khi không đổi (theo phần tử, không theo khoá: thẻ dựng lại cùng khoá phải được đặt lại vị trí)

    const syncPriceLines = (series: ISeriesApi<SeriesType>) => {
      if (synced !== series) {
        synced = series; // series mới (đổi loại nến): price line cũ đã mất cùng series cũ
        priceLines = new Map();
      }
      const want = linesRef.current;
      const f = focusRef.current;
      const keep = new Set(want.map((w) => w.key));
      for (const [k, l] of priceLines) {
        if (!keep.has(k)) {
          series.removePriceLine(l);
          priceLines.delete(k);
        }
      }
      for (const w of want) {
        const dim = f !== null && w.tag !== undefined && OWNER_ID(w.tag.owner) !== f;
        const opts = { price: w.price, color: dim ? withAlpha(w.color, DIM) : w.color, lineWidth: 1 as const, lineStyle: STYLE[w.style], axisLabelVisible: !dim, title: w.tag ? "" : w.title };
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
      // lớp phủ chỉ phủ đúng pane chính (đường giá / thẻ lệnh nằm trong pane này và bị cắt ở mép pane)
      const mr = getMainRect();
      const place = `${mr.top}|${mr.height}`;
      if (placedAt !== place) {
        placedAt = place;
        box.style.top = `${mr.top}px`;
        box.style.height = `${mr.height}px`;
      }
      if (dirty.current || synced !== series) {
        dirty.current = false;
        syncPriceLines(series);
      }
      const wantLines = linesRef.current;
      if (wantLines.length === 0 && els.current.size === 0 && lastLink === "") return; // không có gì để vẽ: khỏi đo layout mỗi khung hình
      const h = mr.height;
      const right = box.clientWidth - chart.timeScale().width() + RIGHT_GAP;
      const linkX = chart.timeScale().width() - LINK_X;
      const ys = new Map<string, number>();
      for (const l of wantLines) {
        const y = series.priceToCoordinate(l.price);
        if (y !== null) ys.set(l.key, y as number);
      }
      const zone = zoneRef.current;
      const zy = zone ? ys.get(zone.key) : undefined;
      const ze = zoneEl.current;
      if (ze) {
        if (!zone || zy === undefined) ze.style.display = "none";
        else {
          const ph = h;
          const y = Math.min(Math.max(zy, 0), ph);
          ze.style.display = "block";
          ze.style.width = `${chart.timeScale().width()}px`;
          ze.style.top = `${zone.up ? 0 : y}px`;
          ze.style.height = `${zone.up ? y : ph - y}px`;
          ze.style.background = withAlpha(zone.color, 0.15);
        }
      }
      for (const [key, el] of els.current) {
        const y = ys.get(key);
        const visible = y !== undefined && y >= -TAG_H && y <= h + TAG_H;
        const sig = visible ? `${right}|${Math.round(y)}` : "";
        if (placed.get(el) === sig) continue;
        placed.set(el, sig);
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
      const f = focusRef.current;
      const groups = new Map<string, LineSpec[]>();
      for (const l of wantLines) if (l.tag && ys.has(l.key)) groups.set(OWNER_ID(l.tag.owner), [...(groups.get(OWNER_ID(l.tag.owner)) ?? []), l]);
      const hov = hoverRef.current ?? useTradeFocus.getState().hover; // trỏ vào thẻ, hoặc trỏ gần đường (LineDrag báo)
      for (const [owner, g] of groups) {
        const entry = g.find((l) => l.tag?.kind === "entry") ?? g[0];
        const active = owner === f || owner === hov;
        const linked = g.length >= 2 && (entry.tag?.draft || active); // lệnh đã đặt: đường nối chỉ hiện khi chọn (focus) hoặc trỏ vào
        if (!linked && !active) continue;
        const op = f !== null && owner !== f ? DIM : entry.tag?.draft ? 0.6 : 0.9;
        const w = f === owner ? 2 : 1;
        if (linked) {
          const gy = g.map((l) => ys.get(l.key) as number);
          svg += `<line x1="${linkX}" x2="${linkX}" y1="${Math.min(...gy)}" y2="${Math.max(...gy)}" stroke="${entry.color}" stroke-width="${w}" stroke-dasharray="4 3" opacity="${op}"/>`;
        }
        for (const l of g) {
          const cy = ys.get(l.key);
          // chấm tròn kéo được (như TradingView): vòng rỗng + quầng sáng khi đang trỏ / chọn lệnh này; chỉ có đường nối thì giữ chấm đặc ở giá vào
          if (active) svg += `<circle cx="${linkX}" cy="${cy}" r="8" fill="${l.color}" opacity="0.22"/><circle cx="${linkX}" cy="${cy}" r="3.5" fill="var(--bg)" stroke="${l.color}" stroke-width="${w + 0.5}"/>`;
          else svg += `<circle cx="${linkX}" cy="${cy}" r="3.5" fill="${l === entry ? l.color : "var(--bg)"}" stroke="${l.color}" stroke-width="${w + 0.5}" opacity="${op}"/>`;
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
  }, [getChart, getSeries, getMainRect]);

  const events = tool ? "pointer-events-none" : "pointer-events-auto";
  const digits = getDigits();

  return (
    <div ref={root} className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-full overflow-hidden" data-testid="trade-overlay">
      <svg ref={link} className="absolute inset-0 h-full w-full" aria-hidden />
      <div ref={zoneEl} className="absolute left-0 hidden" aria-hidden />
      {lines.flatMap((l) => {
        const tag = l.tag;
        if (!tag) return [];
        const isSim = tag.owner.t === "position" && tag.owner.ticket === SIM_TICKET;
        const live = tag.draft || modify || isSim; // đã đặt thì cần được phép sửa: guest / real / EA tắt chỉ xem (vị thế giả lập của Replay thì luôn đóng được)
        const draggable = live && !(tag.kind === "entry" && tag.owner.t === "position"); // giá vào của vị thế đã khớp không kéo được; SL/TP, lệnh chờ và bản nháp thì có
        const c = l.color;
        const mine = OWNER_ID(tag.owner);
        const base = tag.draft && tag.kind !== "entry" ? 0.75 : tag.draft ? 0.9 : 1; // bản nháp hơi mờ; lệnh đã đặt đang sửa chờ xác nhận (pending) vẫn sáng đủ
        const fade = focus !== null && mine !== focus ? Math.min(base, DIM) : base; // lệnh khác đang được focus: mờ hẳn
        // mờ bằng độ đục của màu chữ / viền, không phải opacity cả thẻ: nền thẻ phải đặc để đường giá chạy ngang không lộ xuyên qua
        const fc = (x: string) => withAlpha(x, fade);
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
            onPointerEnter={() => (hoverRef.current = mine)}
            onPointerLeave={() => {
              if (hoverRef.current === mine) hoverRef.current = null;
            }}
            onPointerDownCapture={() => useTradeFocus.getState().set(mine)} // chạm vào bất cứ phần nào của thẻ (kể cả bắt đầu kéo) = focus lệnh này
            onClick={(e) => {
              // bấm (không kéo: kéo thì LineDrag giữ con trỏ nên không có click ở đây) vào thẻ của lệnh đã đặt = chọn lệnh, mở bảng Modify; nút trên thẻ tự xử lý
              if (tag.owner.t !== "draft" && !(e.target as Element).closest("button")) useTicketStore.getState().select(mine);
            }}
            className="absolute left-auto top-0 hidden select-none items-center gap-2 text-[12px] font-medium leading-none"
            style={{ height: TAG_H, zIndex: focus === mine ? 2 : undefined }}
          >
            {tag.kind === "entry" && live && pendingOwners.has(OWNER_ID(tag.owner)) && (
              <>
                <button
                  type="button"
                  data-tag-btn
                  title="Bỏ thay đổi (Esc)"
                  onClick={() => onCancelEdit(OWNER_ID(tag.owner))}
                  className={`${events} cursor-pointer rounded border border-[var(--fg)]/50 px-2.5 text-[12px] font-medium hover:bg-white/10`}
                  style={{ height: TAG_H, background: "var(--bg)", color: "var(--fg)" }}
                >
                  Discard
                </button>
                <button
                  type="button"
                  data-tag-btn
                  title="Áp dụng thay đổi"
                  onClick={() => onConfirmEdit(OWNER_ID(tag.owner))}
                  className={`${events} cursor-pointer rounded px-2.5 text-[12px] font-semibold text-white hover:brightness-110`}
                  style={{ height: TAG_H, background: "#2962ff" }}
                >
                  Confirm
                </button>
              </>
            )}
            {live &&
              tag.ghosts.map((k) => {
                const hue = k === "tp" ? "#089981" : "#ff9800";
                const tint = withAlpha(hue, 0.15 * fade);
                return (
                <button
                  key={k}
                  type="button"
                  data-tag-btn
                  onPointerEnter={() => {
                    if (tag.side) zoneRef.current = { key: l.key, up: (k === "tp") === (tag.side === "buy"), color: hue };
                  }}
                  onPointerLeave={() => (zoneRef.current = null)}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    zoneRef.current = null;
                    onGhost(tag.owner, k, e.nativeEvent);
                  }}
                  className={`${events} group/ghost relative min-w-[38px] cursor-pointer rounded border border-dotted px-3 font-semibold hover:brightness-125`}
                  style={{ height: TAG_H, color: fc(hue), borderColor: fc(hue), background: `linear-gradient(${tint}, ${tint}), var(--bg)` }} // phủ màu nhạt như TradingView, trên nền đặc để đường giá không lộ xuyên qua
                >
                  {KIND_NAME[k]}
                  <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[#363a45] px-2.5 py-2 text-[12px] font-normal leading-none text-[#d1d4dc] shadow-lg group-hover/ghost:block group-active/ghost:hidden">
                    Drag to add {KIND_FULL[k]}
                  </span>
                </button>
                );
              })}
            <div
              data-line-key={live ? l.key : undefined}
              title={`${ownerName(tag.owner)} · ${tag.kind === "entry" ? "giá vào" : KIND_NAME[tag.kind]}`}
              className={`${events} flex items-stretch overflow-hidden rounded border tabular-nums ${draggable ? "cursor-pointer" : ""}`}
              style={{ height: TAG_H, color: tagText(fc(c)), borderColor: fc(c), background: "var(--bg)", boxShadow: focus === mine ? `0 0 0 1px ${c}` : undefined }}
            >
              <span className="flex items-center border-r px-2" style={{ borderColor: fc(c) }}>
                {tag.qty}
              </span>
              <span className="flex min-w-[52px] items-center justify-center whitespace-nowrap px-2.5" style={{ borderColor: fc(c), color: tag.label.startsWith("+") ? fc(PNL_UP) : tag.label.startsWith("-") ? fc(PNL_DOWN) : undefined }}>
                {tag.label}
              </span>
              {live && !tag.pending && (
                <button
                  type="button"
                  data-tag-btn
                  title={closeTitle}
                  aria-label={closeTitle}
                  onClick={() => (isSim ? closeSim(paneId, tag.kind, symInfo, ccy) : closeFromTag(l, symbol, digits))}
                  className="flex w-6 cursor-pointer items-center justify-center border-l hover:bg-white/10"
                  style={{ borderColor: fc(c) }}
                >
                  {/* vẽ bằng SVG để dấu × nằm đúng tâm nút (ký tự × lệch xuống theo đường cơ sở của chữ) */}
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
                    <path d="M1 1l6 6M7 1L1 7" />
                  </svg>
                </button>
              )}
            </div>
            {tag.place && (
              <button
                type="button"
                data-tag-btn
                title={tag.label === "Market" ? `${tag.place} market` : `Đặt ${tag.label}`}
                onClick={placeFromTag}
                className={`${events} ml-6 cursor-pointer rounded px-3 text-[12px] font-semibold text-white hover:brightness-110`}
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
