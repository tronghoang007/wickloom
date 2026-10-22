import type { LotSpec } from "./lot";

// Lệnh chờ: loại (Limit/Stop) suy ra từ giá vào so với giá thị trường, người dùng chỉ chọn hướng + giá (docs/trade-plan.md mục 3). Hàm thuần.
export type Side = "buy" | "sell";
export type PendingType = "buy_limit" | "sell_limit" | "buy_stop" | "sell_stop";

const LABEL: Record<PendingType, string> = { buy_limit: "Buy limit", sell_limit: "Sell limit", buy_stop: "Buy stop", sell_stop: "Sell stop" };
export const pendingLabel = (t: PendingType) => LABEL[t];
export const isPendingType = (t: string): t is PendingType => t in LABEL;
export const sideOfType = (t: PendingType): Side => (t.startsWith("buy") ? "buy" : "sell");

/** Buy dưới Ask = Limit, trên Ask = Stop; Sell trên Bid = Limit, dưới Bid = Stop. Bằng giá thị trường thì null (không đặt được lệnh chờ). */
export function resolveOrderType(side: Side, price: number, bid: number, ask: number): PendingType | null {
  if (side === "buy") return price < ask ? "buy_limit" : price > ask ? "buy_stop" : null;
  return price > bid ? "sell_limit" : price < bid ? "sell_stop" : null;
}

/** Hướng mặc định khi mở ticket tại một giá: dưới thị trường → Buy (Limit), trên → Sell (Limit). */
export const defaultSide = (price: number, bid: number, ask: number): Side => (price <= (bid + ask) / 2 ? "buy" : "sell");

/** Làm tròn giá về bội của tick_size (rồi về `digits` chữ số). */
export function snapPrice(price: number, tickSize: number, digits: number): number {
  const t = tickSize > 0 ? tickSize : 10 ** -digits;
  return Number((Math.round(price / t) * t).toFixed(digits));
}

const pointOf = (digits: number) => 10 ** -digits;

/** Khoảng cách (đơn vị giá) từ giá vào tới mép thị trường mà broker đo stops level: Buy Limit/Stop đo từ Ask, Sell từ Bid. */
export function marketDistance(type: PendingType, price: number, bid: number, ask: number): number {
  if (type === "buy_limit") return ask - price;
  if (type === "buy_stop") return price - ask;
  if (type === "sell_limit") return price - bid;
  return bid - price;
}

/** Giá vào có nằm trong vùng cấm (SYMBOL_TRADE_STOPS_LEVEL điểm quanh giá thị trường) không. stopsLevel = 0 / thiếu → không ràng buộc. */
export function tooClose(type: PendingType, price: number, bid: number, ask: number, stopsLevel: number | null | undefined, digits: number): boolean {
  if (!stopsLevel || stopsLevel <= 0) return false;
  return marketDistance(type, price, bid, ask) < stopsLevel * pointOf(digits) - pointOf(digits) / 2;
}

export type PendingInput = {
  side: Side;
  price: number;
  lot: number;
  sl: number; // 0 = không đặt
  tp: number;
  expiration: number; // epoch giây UTC; 0 = GTC
  bid: number;
  ask: number;
  digits: number;
  stopsLevel?: number | null;
  spec: LotSpec | null;
  nowSec: number;
};

/** Vì sao chưa đặt được (null = đặt được). Chỉ để báo sớm trên ticket: EA và sàn mới là nơi quyết định. */
export function validatePending(i: PendingInput): string | null {
  if (!Number.isFinite(i.price) || i.price <= 0) return "Nhập giá vào";
  if (!i.spec) return "Chưa có thông số lot của symbol (cần EA ≥ 2.12)";
  if (!(i.lot >= i.spec.min - 1e-9) || i.lot > i.spec.max + 1e-9) return `Lot phải trong khoảng ${i.spec.min}–${i.spec.max}`;
  if (!(i.bid > 0) || !(i.ask > 0)) return "Chưa có giá thị trường";
  const type = resolveOrderType(i.side, i.price, i.bid, i.ask);
  if (!type) return "Giá vào đang bằng giá thị trường: dùng nút Buy/Sell";
  const level = i.stopsLevel ?? 0;
  if (tooClose(type, i.price, i.bid, i.ask, level, i.digits)) return `Quá gần giá thị trường (tối thiểu ${level} điểm)`;
  const buy = i.side === "buy";
  const minGap = level * pointOf(i.digits);
  const gapOk = (stop: number) => Math.abs(stop - i.price) >= minGap - pointOf(i.digits) / 2;
  if (i.sl > 0) {
    if (buy ? i.sl >= i.price : i.sl <= i.price) return buy ? "SL của lệnh Buy phải thấp hơn giá vào" : "SL của lệnh Sell phải cao hơn giá vào";
    if (!gapOk(i.sl)) return `SL quá gần giá vào (tối thiểu ${level} điểm)`;
  }
  if (i.tp > 0) {
    if (buy ? i.tp <= i.price : i.tp >= i.price) return buy ? "TP của lệnh Buy phải cao hơn giá vào" : "TP của lệnh Sell phải thấp hơn giá vào";
    if (!gapOk(i.tp)) return `TP quá gần giá vào (tối thiểu ${level} điểm)`;
  }
  if (i.expiration && i.expiration <= i.nowSec + 60) return "Thời điểm hết hạn phải sau hiện tại ít nhất 1 phút";
  return null;
}
