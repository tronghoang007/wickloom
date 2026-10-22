import { COLORS, ghostsFor, sideColor, stopLabel, type LineSpec, type StopTitleFn } from "./format";
import { pendingLabel, resolveOrderType, snapPrice, type Side } from "./orderType";

// Bản nháp lệnh trong bảng đặt lệnh (docs/trade-plan.md T3-T4). Giá trị là CHUỖI để gõ dở ("4120.") vẫn giữ nguyên; entry/SL/TP của bản nháp cũng vẽ
// lên chart thành đường kéo được, kéo thì ghi ngược vào các chuỗi này. Hàm thuần.
export type TicketMode = "market" | "pending";

export type Draft = {
  symbol: string;
  side: Side;
  mode: TicketMode;
  price: string; // giá vào của lệnh chờ
  sl: string; // rỗng = không đặt
  tp: string;
  lot: string;
  until: boolean; // đặt hết hạn
  untilText: string; // datetime-local
};

export const parseNum = (t: string): number => (t.trim() === "" ? 0 : parseFloat(t.replace(",", ".")));

export type DraftField = "price" | "sl" | "tp";
export const DRAFT_IDS: Record<string, DraftField> = { "d:entry": "price", "d:sl": "sl", "d:tp": "tp" };

/** Đường của bản nháp trên chart của `symbol` (nét đứt như TradingView): giá vào + thẻ có nút đặt lệnh (lệnh chờ: ở giá đã nhập, nhãn loại lệnh theo giá thị trường hiện tại; Market: ở giá khớp
 *  Ask / Bid, kéo đi chỗ khác thì thành lệnh chờ), SL / TP chấm chấm kèm lãi/lỗi. Chưa có giá vào hợp lệ (chưa nhập, chưa có tick) thì không có đường giá vào. */
export function draftLines(d: Draft | null, symbol: string, quote: { bid: number; ask: number } | undefined, stopTitle?: StopTitleFn): LineSpec[] {
  if (!d || d.symbol !== symbol) return [];
  const out: LineSpec[] = [];
  const pending = d.mode === "pending";
  const price = parseNum(d.price);
  // giá vào dùng để vẽ và tính lãi/lỗi: giá vào của lệnh chờ, hoặc giá khớp market (Buy mua ở Ask, Sell bán ở Bid)
  const entry = pending ? price : quote ? (d.side === "buy" ? quote.ask : quote.bid) : 0;
  const sl = parseNum(d.sl);
  const tp = parseNum(d.tp);
  const lot = parseNum(d.lot);
  const sideName = d.side === "buy" ? "Buy" : "Sell";
  if (entry > 0) {
    const type = pending && quote ? resolveOrderType(d.side, price, quote.bid, quote.ask) : null;
    const label = !pending ? "Market" : type ? pendingLabel(type) : sideName;
    out.push({
      key: "d:entry",
      price: entry,
      color: sideColor(d.side),
      style: "dashed",
      title: `${label} ${d.lot}`.toUpperCase(),
      tag: { kind: "entry", owner: { t: "draft" }, qty: d.lot, label, ghosts: ghostsFor(sl, tp), place: sideName, draft: true },
    });
  }
  const title = (kind: "sl" | "tp", p: number) => (stopTitle ? stopTitle(kind, d.side, lot, entry, p, symbol) : kind.toUpperCase());
  for (const [kind, v, color] of [["sl", sl, COLORS.sl], ["tp", tp, COLORS.tp]] as const) {
    if (!(v > 0)) continue;
    const t = title(kind, v);
    out.push({ key: `d:${kind}`, price: v, color, style: "dotted", title: t, tag: { kind, owner: { t: "draft" }, qty: d.lot, label: stopLabel(t), ghosts: [], draft: true } });
  }
  return out;
}

/** Mức SL/TP gợi ý khi bấm "+" trên bảng: cách giá tham chiếu 0.25% (ít nhất 1.5 lần stops level), đúng phía theo hướng, làm tròn theo tick. */
export function defaultStop(kind: "sl" | "tp", side: Side, ref: number, tickSize: number, digits: number, stopsLevel?: number | null): number {
  const point = 10 ** -digits;
  const dist = Math.max(ref * 0.0025, (stopsLevel ?? 0) * point * 1.5, point * 10);
  const below = (kind === "sl") === (side === "buy"); // SL của Buy và TP của Sell nằm dưới giá vào
  return snapPrice(below ? ref - dist : ref + dist, tickSize, digits);
}
