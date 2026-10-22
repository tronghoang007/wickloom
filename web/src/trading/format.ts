import type { Deal, PendingOrder, Position, TradeData } from "@/lib/mt5Api";

// Hàm thuần cho panel Trading và đường vị thế/lệnh chờ trên chart (docs/trade-plan.md T1: chỉ đọc).

const ORDER_LABEL: Record<PendingOrder["type"], string> = {
  buy_limit: "Buy limit", sell_limit: "Sell limit", buy_stop: "Buy stop", sell_stop: "Sell stop",
  buy_stop_limit: "Buy stop limit", sell_stop_limit: "Sell stop limit", other: "Order",
};
export const orderLabel = (t: PendingOrder["type"]) => ORDER_LABEL[t] ?? "Order";
export const sideLabel = (t: Position["type"] | Deal["type"]) => (t === "buy" ? "Buy" : t === "sell" ? "Sell" : t === "balance" ? "Balance" : "—");

/** Lot: tối thiểu 2 chữ số thập phân, tới 8 nếu symbol có step nhỏ (0.001). */
export function fmtLot(v: number): string {
  const s = v.toFixed(8).replace(/0+$/, "");
  const dec = s.split(".")[1]?.length ?? 0;
  return v.toFixed(Math.max(2, dec));
}

/** Giá theo số chữ số của symbol (biết từ danh sách symbols); không biết thì bỏ số 0 thừa. 0 = không đặt (SL/TP) → "—" khi `dash`. */
export function fmtPx(v: number, digits?: number, dash = false): string {
  if (dash && v === 0) return "—";
  return digits === undefined ? String(Number(v.toFixed(5))) : v.toFixed(digits);
}

/** "+47.50" / "-12.00" / "0.00" */
export const fmtPnl = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pnlClass = (v: number) => (v > 0 ? "text-[#089981]" : v < 0 ? "text-[#f23645]" : "text-[var(--muted)]");

export const fmtTime = (sec: number) =>
  sec ? new Date(sec * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "—";

/** P/L đang mở của các vị thế = profit + swap (commission chỉ có ở deal). */
export const positionPnl = (p: Position) => p.profit + p.swap;
export const totalPnl = (ps: Position[]) => ps.reduce((s, p) => s + positionPnl(p), 0);

/** Lãi/lỗ cuối cùng của một deal trong lịch sử (kể cả phí). */
export const dealNet = (d: Deal) => d.profit + d.commission + d.swap;

export const STALE_SECONDS = 15;
/** Dữ liệu cũ: account offline, hoặc EA lâu rồi chưa báo vị thế/lệnh. UI phải làm mờ và không vẽ đường trên chart. */
export function isStale(data: TradeData | null, nowSec: number): boolean {
  if (!data) return true;
  if (!data.account.online) return true;
  return data.updated_at === null || nowSec - data.updated_at > STALE_SECONDS;
}

export type LineSpec = { key: string; price: number; color: string; dashed: boolean; title: string };

export const COLORS = { buy: "#2962ff", sell: "#ff9800", sl: "#f23645", tp: "#089981", order: "#d69a00" };

/** Đường trên chart của symbol hiện tại: entry + SL + TP của vị thế, giá + SL + TP của lệnh chờ. Dữ liệu cũ thì không có đường nào. */
export function tradeLines(data: TradeData | null, symbol: string, nowSec: number): LineSpec[] {
  if (!data || isStale(data, nowSec)) return [];
  const out: LineSpec[] = [];
  for (const p of data.positions) {
    if (p.symbol !== symbol || p.type === "other") continue;
    const buy = p.type === "buy";
    out.push({ key: `p:${p.ticket}`, price: p.price_open, color: buy ? COLORS.buy : COLORS.sell, dashed: false, title: `${buy ? "BUY" : "SELL"} ${fmtLot(p.volume)}  ${fmtPnl(positionPnl(p))}` });
    if (p.sl > 0) out.push({ key: `psl:${p.ticket}`, price: p.sl, color: COLORS.sl, dashed: true, title: "SL" });
    if (p.tp > 0) out.push({ key: `ptp:${p.ticket}`, price: p.tp, color: COLORS.tp, dashed: true, title: "TP" });
  }
  for (const o of data.orders) {
    if (o.symbol !== symbol || o.price_open <= 0) continue;
    out.push({ key: `o:${o.ticket}`, price: o.price_open, color: COLORS.order, dashed: true, title: `${orderLabel(o.type).toUpperCase()} ${fmtLot(o.volume)}` });
    if (o.sl > 0) out.push({ key: `osl:${o.ticket}`, price: o.sl, color: COLORS.sl, dashed: true, title: "SL" });
    if (o.tp > 0) out.push({ key: `otp:${o.ticket}`, price: o.tp, color: COLORS.tp, dashed: true, title: "TP" });
  }
  return out;
}
