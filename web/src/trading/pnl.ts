import type { SymbolInfo } from "@/lib/api";
import { fmtPnl } from "./format";
import type { Side } from "./orderType";

// Lãi / lỗi dự kiến của SL / TP (docs/trade-plan.md T4), theo tiền của account. Dùng giá trị một tick mà MT5 báo (SYMBOL_TRADE_TICK_VALUE_PROFIT / _LOSS, EA >= 2.14) nên đúng với
// mọi loại symbol (cặp có đồng tiền lãi khác đồng account, vàng, chỉ số...). Chưa có tick_value thì KHÔNG hiện số (tốt hơn hiện số sai). Hàm thuần.
export type PnlSpec = { tickSize: number; tickValue: number; tickValueLoss: number };

export function pnlSpec(sym: SymbolInfo | undefined): PnlSpec | null {
  const tickSize = sym?.tick_size;
  const tv = sym?.tick_value;
  if (!tickSize || tickSize <= 0 || !tv || tv <= 0) return null;
  const tl = sym?.tick_value_loss;
  return { tickSize, tickValue: tv, tickValueLoss: tl && tl > 0 ? tl : tv };
}

const dirOf = (side: Side) => (side === "buy" ? 1 : -1);

/** Lãi (+) / lỗi (−) nếu vị thế `side` `lot` lot mở ở `entry` và đóng ở `exit`. */
export function estimatePnl(side: Side, lot: number, entry: number, exit: number, s: PnlSpec): number {
  const ticks = ((exit - entry) * dirOf(side)) / s.tickSize;
  return ticks * (ticks >= 0 ? s.tickValue : s.tickValueLoss) * lot;
}

/** Ngược lại: giá đóng để lãi / lỗi đúng `amount` (dương = lãi, âm = lỗ). null nếu lot không hợp lệ. */
export function priceForPnl(side: Side, lot: number, entry: number, amount: number, s: PnlSpec): number | null {
  if (!(lot > 0) || !Number.isFinite(amount)) return null;
  const ticks = amount / ((amount >= 0 ? s.tickValue : s.tickValueLoss) * lot);
  return entry + dirOf(side) * ticks * s.tickSize;
}

/** Khoảng cách tính bằng điểm (point = 10^-digits). */
export const pointsBetween = (a: number, b: number, digits: number) => Math.round(Math.abs(a - b) / 10 ** -digits);

/** SL của Buy và TP của Sell nằm dưới giá vào (dir = −1); TP của Buy và SL của Sell nằm trên (dir = +1). */
export const stopDir = (kind: "sl" | "tp", side: Side): 1 | -1 => ((kind === "sl") === (side === "buy") ? -1 : 1);

export const priceFromPoints = (entry: number, points: number, kind: "sl" | "tp", side: Side, digits: number) => entry + stopDir(kind, side) * points * 10 ** -digits;

/** "+78.30 USD" / "-12.40 USD" cho nhãn đường SL/TP. */
export const fmtPnlCcy = (v: number, ccy: string) => `${fmtPnl(v)}${ccy ? ` ${ccy}` : ""}`;

/** Nhãn đường SL / TP: "SL -12.40 USD"; không biết tick_value thì chỉ "SL". `entry` = giá vào của vị thế / lệnh (hoặc giá thị trường của lệnh market đang soạn). */
export function stopTitle(kind: "sl" | "tp", side: Side, lot: number, entry: number, price: number, spec: PnlSpec | null, ccy: string): string {
  const name = kind.toUpperCase();
  return spec && entry > 0 && lot > 0 ? `${name} ${fmtPnlCcy(estimatePnl(side, lot, entry, price, spec), ccy)}` : name;
}
