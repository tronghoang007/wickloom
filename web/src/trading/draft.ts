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

/** Số người dùng gõ / dán: "0,01" là 0.01 (dấu phẩy thập phân); có cả hai dấu thì dấu đứng sau cùng là dấu thập phân, dấu kia là phân cách nghìn ("4,120.50" và "4.120,50" đều là 4120.5). */
export const parseNum = (t: string): number => {
  const s = t.trim();
  if (s === "") return 0;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) return parseFloat(comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  return parseFloat(s.replace(",", "."));
};

/** Giá người dùng gõ: như `parseNum`, thêm dấu phân cách nghìn mà chart / bảng hiện ("4,087.44"). Hai nhóm nghìn trở lên ("1,234,567" / "1.234.567") chắc chắn là nghìn.
 *  Đúng một nhóm 3 chữ số ("4,050" / "4.050") thì có thể là 4.05 hoặc 4050: chọn cách đọc gần `ref` (giá thị trường) hơn; không có `ref` thì giữ cách đọc thập phân như `parseNum`. */
export const parsePrice = (t: string, ref?: number): number => {
  const s = t.trim();
  const m = /^[+-]?\d{1,3}([,.])\d{3}(?:\1\d{3})*$/.exec(s);
  if (!m) return parseNum(s);
  const thousands = parseFloat(s.split(m[1]).join(""));
  if (s.split(m[1]).length > 2) return thousands;
  const decimal = parseFloat(s.replace(m[1], "."));
  return ref && ref > 0 && Math.abs(thousands - ref) < Math.abs(decimal - ref) ? thousands : decimal;
};

/** Giá vào / SL / TP của bản nháp (đọc theo giá thị trường `quote` để hiểu đúng dấu phân cách nghìn). */
export function draftPrices(d: Draft, quote: { bid: number; ask: number } | undefined): { price: number; sl: number; tp: number } {
  const ref = quote ? (quote.bid + quote.ask) / 2 : undefined;
  return { price: parsePrice(d.price, ref), sl: parsePrice(d.sl, ref), tp: parsePrice(d.tp, ref) };
}

/** Các mức giá của bản nháp phải nằm trong khung giá đang thấy (giá vào của lệnh chờ, SL, TP đã nhập hợp lệ). Phone dùng cho co giãn tự động: chart thấp, đường nháp hay rơi ra ngoài khung. */
export function draftLevels(d: Draft | null, symbol: string, quote: { bid: number; ask: number } | undefined): number[] {
  if (!d || d.symbol !== symbol) return [];
  const { price, sl, tp } = draftPrices(d, quote);
  return [d.mode === "pending" ? price : 0, sl, tp].filter((v) => Number.isFinite(v) && v > 0);
}

export type DraftField = "price" | "sl" | "tp";
export const DRAFT_IDS: Record<string, DraftField> = { "d:entry": "price", "d:sl": "sl", "d:tp": "tp" };

/** Đường của bản nháp trên chart của `symbol` (giá vào nét liền như lệnh đã đặt; bản nháp phân biệt bằng thẻ hơi mờ): giá vào + thẻ có nút đặt lệnh (lệnh chờ: ở giá đã nhập, nhãn loại lệnh theo giá thị trường hiện tại; Market: ở giá khớp
 *  Ask / Bid, kéo đi chỗ khác thì thành lệnh chờ), SL / TP nét liền kèm lãi/lỗi. Chưa có giá vào hợp lệ (chưa nhập, chưa có tick) thì không có đường giá vào. */
export function draftLines(d: Draft | null, symbol: string, quote: { bid: number; ask: number } | undefined, stopTitle?: StopTitleFn): LineSpec[] {
  if (!d || d.symbol !== symbol) return [];
  const out: LineSpec[] = [];
  const pending = d.mode === "pending";
  const { price, sl, tp } = draftPrices(d, quote);
  // giá vào dùng để vẽ và tính lãi/lỗi: giá vào của lệnh chờ, hoặc giá khớp market (Buy mua ở Ask, Sell bán ở Bid)
  const entry = pending ? price : quote ? (d.side === "buy" ? quote.ask : quote.bid) : 0;
  const lot = parseNum(d.lot);
  const sideName = d.side === "buy" ? "Buy" : "Sell";
  if (entry > 0) {
    const type = pending && quote ? resolveOrderType(d.side, price, quote.bid, quote.ask) : null;
    const label = !pending ? "Market" : type ? pendingLabel(type) : sideName;
    out.push({
      key: "d:entry",
      price: entry,
      color: sideColor(d.side),
      style: "solid",
      title: `${label} ${d.lot}`.toUpperCase(),
      tag: { kind: "entry", owner: { t: "draft" }, qty: d.lot, label, ghosts: ghostsFor(sl, tp), place: sideName, draft: true, side: d.side },
    });
  }
  const title = (kind: "sl" | "tp", p: number) => (stopTitle ? stopTitle(kind, d.side, lot, entry, p, symbol) : kind.toUpperCase());
  for (const [kind, v, color] of [["sl", sl, COLORS.sl], ["tp", tp, COLORS.tp]] as const) {
    if (!(v > 0)) continue;
    const t = title(kind, v);
    out.push({ key: `d:${kind}`, price: v, color, style: "solid", title: t, tag: { kind, owner: { t: "draft" }, qty: d.lot, label: stopLabel(t), ghosts: [], draft: true } });
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
