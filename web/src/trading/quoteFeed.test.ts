import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mt5Account, Position, TradeData } from "@/lib/mt5Api";
import { useQuoteStore } from "./quote";
import { startQuoteFeed } from "./quoteFeed";
import { useTradeStore } from "./store";

class FakeWs {
  static OPEN = 1;
  static all: FakeWs[] = [];
  readyState = 0;
  sent: { action: string; symbol: string; tf: string }[] = [];
  closed = false;
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  constructor(public url: string) {
    FakeWs.all.push(this);
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  tick(symbol: string, bid: number, ask: number) {
    this.onmessage?.({ data: JSON.stringify({ type: "tick", symbol, bid, ask }) });
  }
}

const account = { id: "S:1", currency: "USD" } as Mt5Account;
const pos = (symbol: string) => ({ ticket: 1, symbol, type: "buy" }) as Position;
const trade = (...symbols: string[]): TradeData => ({ account, positions: symbols.map(pos), orders: [], deals: [], updated_at: 1 });

beforeEach(() => {
  FakeWs.all = [];
  vi.stubGlobal("WebSocket", FakeWs);
  useQuoteStore.setState({ quotes: {}, real: {}, sim: false });
  useTradeStore.setState({ data: null, real: null, sim: false });
});
afterEach(() => vi.unstubAllGlobals());

describe("startQuoteFeed", () => {
  it("chưa có lệnh thì không mở kết nối; có lệnh thì subscribe symbol đó và ghi tick vào kho giá", () => {
    const stop = startQuoteFeed();
    expect(FakeWs.all).toHaveLength(0);
    useTradeStore.setState({ real: trade("XAUUSDm") });
    const ws = FakeWs.all[0];
    ws.open();
    expect(ws.sent).toEqual([{ action: "subscribe", symbol: "XAUUSDm", tf: "M1" }]);
    ws.tick("XAUUSDm", 4020.1, 4020.3);
    ws.tick("BTCUSDm", 1, 2); // symbol không có lệnh: bỏ (chart của nó tự ghi)
    expect(useQuoteStore.getState().real).toEqual({ XAUUSDm: { bid: 4020.1, ask: 4020.3 } });
    stop();
    expect(ws.closed).toBe(true);
  });

  it("đổi danh sách lệnh: subscribe symbol mới, unsubscribe symbol hết lệnh; hết lệnh thì đóng kết nối", () => {
    useTradeStore.setState({ real: trade("XAUUSDm") });
    const stop = startQuoteFeed();
    const ws = FakeWs.all[0];
    ws.open();
    useTradeStore.setState({ real: trade("EURUSDm") });
    expect(ws.sent.slice(1)).toEqual([
      { action: "subscribe", symbol: "EURUSDm", tf: "M1" },
      { action: "unsubscribe", symbol: "XAUUSDm", tf: "M1" },
    ]);
    useTradeStore.setState({ real: trade() });
    expect(ws.closed).toBe(true);
    expect(FakeWs.all).toHaveLength(1); // đóng chủ động: không nối lại
    stop();
  });

  it("mất kết nối thì nối lại sau 2s và subscribe lại", () => {
    vi.useFakeTimers();
    useTradeStore.setState({ real: trade("XAUUSDm") });
    const stop = startQuoteFeed();
    FakeWs.all[0].open();
    FakeWs.all[0].onclose?.();
    vi.advanceTimersByTime(2000);
    const ws2 = FakeWs.all[1];
    ws2.open();
    expect(ws2.sent).toEqual([{ action: "subscribe", symbol: "XAUUSDm", tf: "M1" }]);
    stop();
    vi.useRealTimers();
  });
});
