import { COLORS, type LineSpec, type StopTitleFn } from "./format";
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

/** Đường của bản nháp trên chart của `symbol`: giá vào (chỉ lệnh chờ, nhãn loại lệnh theo giá thị trường hiện tại), SL đỏ, TP xanh. Nét liền để phân biệt với đường lệnh đã đặt. */
export function draftLines(d: Draft | null, symbol: string, quote: { bid: number; ask: number } | undefined, stopTitle?: StopTitleFn): LineSpec[] {
  if (!d || d.symbol !== symbol) return [];
  const out: LineSpec[] = [];
  const price = parseNum(d.price);
  if (d.mode === "pending" && price > 0) {
    const type = quote ? resolveOrderType(d.side, price, quote.bid, quote.ask) : null;
    const name = type ? pendingLabel(type) : d.side === "buy" ? "Buy" : "Sell";
    out.push({ key: "d:entry", price, color: COLORS.order, dashed: false, title: `${name} ${d.lot}`.toUpperCase() });
  }
  const sl = parseNum(d.sl);
  const tp = parseNum(d.tp);
  // giá vào dùng để tính lãi/lỗi: giá vào của lệnh chờ, hoặc giá khớp market (Buy mua ở Ask, Sell bán ở Bid)
  const entry = d.mode === "pending" ? price : quote ? (d.side === "buy" ? quote.ask : quote.bid) : 0;
  const lot = parseNum(d.lot);
  const title = (kind: "sl" | "tp", p: number) => (stopTitle ? stopTitle(kind, d.side, lot, entry, p, symbol) : kind.toUpperCase());
  if (sl > 0) out.push({ key: "d:sl", price: sl, color: COLORS.sl, dashed: false, title: title("sl", sl) });
  if (tp > 0) out.push({ key: "d:tp", price: tp, color: COLORS.tp, dashed: false, title: title("tp", tp) });
  return out;
}

/** Mức SL/TP gợi ý khi bấm "+" trên bảng: cách giá tham chiếu 0.25% (ít nhất 1.5 lần stops level), đúng phía theo hướng, làm tròn theo tick. */
export function defaultStop(kind: "sl" | "tp", side: Side, ref: number, tickSize: number, digits: number, stopsLevel?: number | null): number {
  const point = 10 ** -digits;
  const dist = Math.max(ref * 0.0025, (stopsLevel ?? 0) * point * 1.5, point * 10);
  const below = (kind === "sl") === (side === "buy"); // SL của Buy và TP của Sell nằm dưới giá vào
  return snapPrice(below ? ref - dist : ref + dist, tickSize, digits);
}
