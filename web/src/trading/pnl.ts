import type { SymbolInfo } from "@/lib/api";
import { fmtPnl } from "./format";
import type { Side } from "./orderType";

// Lãi / lỗi dự kiến của SL / TP (docs/trade-plan.md T4), theo tiền của account. Dùng giá trị một tick mà MT5 báo (SYMBOL_TRADE_TICK_VALUE_PROFIT / _LOSS, EA >= 2.14) nên đúng với
// mọi loại symbol (cặp có đồng tiền lãi khác đồng account, vàng, chỉ số...). Chưa có tick_value thì KHÔNG hiện số (tốt hơn hiện số sai). Hàm thuần.
export type PnlSpec = { tickSize: number; tickValue: number; tickValueLoss: number };

/** Đồng tiền lãi/lỗi suy từ tên symbol cặp 6 chữ cái có hậu tố broker ("XAUUSDm", "EURUSD.raw" → "XAUUSD", "EURUSD"): 3 chữ cuối. null nếu không phải dạng đó (chỉ số, cổ phiếu...). */
function quoteCurrency(name: string): string | null {
  const base = name.replace(/[^A-Za-z0-9].*$/, "").replace(/[a-z]+$/, "");
  return /^[A-Z]{6}$/.test(base) ? base.slice(3) : null;
}

/** Thông số tính lãi/lỗi của symbol. Ưu tiên tick value MT5 báo (EA >= 2.14, đúng với mọi loại symbol). EA cũ chưa báo thì dự phòng CHỈ khi chắc đúng: symbol tính bằng đúng đồng tiền
 *  của account (vd XAUUSDm với account USD) thì giá trị một tick = tick_size × contract_size (EA >= 2.12 báo). Còn lại (cặp chéo, chỉ số...) → null: không hiện số thay vì hiện sai. */
export function pnlSpec(sym: SymbolInfo | undefined, accountCcy?: string): PnlSpec | null {
  const tickSize = sym?.tick_size;
  if (!tickSize || tickSize <= 0) return null;
  const tv = sym?.tick_value;
  if (tv && tv > 0) {
    const tl = sym?.tick_value_loss;
    return { tickSize, tickValue: tv, tickValueLoss: tl && tl > 0 ? tl : tv };
  }
  const size = sym?.contract_size;
  if (accountCcy && size && size > 0 && quoteCurrency(sym.name) === accountCcy.toUpperCase()) {
    const v = tickSize * size;
    return { tickSize, tickValue: v, tickValueLoss: v };
  }
  return null;
}

/** Thông số tính ĐÚNG như MT5 tính lãi / lỗ vị thế: chỉ khi symbol tính bằng chính đồng tiền account (XAUUSDm với account USD): giá trị một tick = tick_size × contract_size,
 *  không đổi theo tỉ giá. Cặp khác (lãi bằng đồng khác, phải quy đổi theo tỉ giá lúc đó) → null. */
export function exactPnlSpec(sym: SymbolInfo | undefined, accountCcy?: string): PnlSpec | null {
  const tickSize = sym?.tick_size;
  const size = sym?.contract_size;
  if (!sym || !accountCcy || !tickSize || tickSize <= 0 || !size || size <= 0 || quoteCurrency(sym.name) !== accountCcy.toUpperCase()) return null;
  const v = tickSize * size;
  return { tickSize, tickValue: v, tickValueLoss: v };
}

const dirOf = (side: Side) => (side === "buy" ? 1 : -1);

/** Lãi (+) / lỗi (−) nếu vị thế `side` `lot` lot mở ở `entry` và đóng ở `exit`. */
export function estimatePnl(side: Side, lot: number, entry: number, exit: number, s: PnlSpec): number {
  const ticks = ((exit - entry) * dirOf(side)) / s.tickSize;
  return ticks * (ticks >= 0 ? s.tickValue : s.tickValueLoss) * lot;
}

const cents = (v: number) => (Math.sign(v) * Math.round(Math.abs(v) * 100 + 1e-7)) / 100;

/** Lãi / lỗ ĐÚNG như MT5 ghi cho symbol tính bằng tiền account (spec của `exactPnlSpec`): MT5 làm tròn từng vế (giá × contract × lot) về cent rồi mới trừ, không làm tròn hiệu.
 *  Buy 0.02 lot vàng 4026.718 → 4027.261: 8054.52 − 8053.44 = 1.08 (làm tròn hiệu 1.086 ra 1.09, lệch MT5). Kiểm trên 67 deal thật của account demo (vàng + BTC) 10-29: khớp cả 67. */
export function mt5Pnl(side: Side, lot: number, entry: number, exit: number, s: PnlSpec): number {
  const perPrice = (s.tickValue / s.tickSize) * lot;
  return cents(dirOf(side) * (cents(exit * perPrice) - cents(entry * perPrice)));
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
