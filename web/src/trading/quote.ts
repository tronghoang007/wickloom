import { create } from "zustand";

// Giá Bid/Ask mới nhất của từng symbol, lấy từ tick realtime mà Chart nhận qua WebSocket. Widget SELL/BUY đọc ở đây.
type Quote = { bid: number; ask: number };
type State = { quotes: Record<string, Quote>; set: (symbol: string, bid: number, ask: number) => void };

export const useQuoteStore = create<State>()((set, get) => ({
  quotes: {},
  set: (symbol, bid, ask) => {
    if (!(bid > 0) || !(ask > 0)) return; // tick thiếu một phía (vd chỉ có last)
    const cur = get().quotes[symbol];
    if (cur && cur.bid === bid && cur.ask === ask) return; // tick lặp: khỏi render lại
    set({ quotes: { ...get().quotes, [symbol]: { bid, ask } } });
  },
}));

/** Spread theo pip như TradingView ("45.0"): symbol 3 / 5 chữ số có pipette nên 1 pip = 10 điểm (vàng 0.45 → 45.0, EURUSD 0.00012 → 1.2); còn lại tính theo điểm. */
export function spreadPips(bid: number, ask: number, digits: number): string {
  const pip = digits === 3 || digits === 5 ? 10 ** -(digits - 1) : 10 ** -digits;
  return Math.max(0, (ask - bid) / pip).toFixed(1);
}

/** Giá có dấu phẩy ngàn, tách chữ số cuối (pipette) ra riêng để vẽ nhỏ + nâng lên như TV: 4087.44 (3 chữ số) → ["4,087.44", "0"]. Symbol không có pipette thì phần sau rỗng. */
export function splitPrice(v: number, digits: number): [string, string] {
  const full = v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return digits === 3 || digits === 5 ? [full.slice(0, -1), full.slice(-1)] : [full, ""];
}
