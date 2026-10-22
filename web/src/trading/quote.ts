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
