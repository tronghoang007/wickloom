import { describe, expect, it } from "vitest";
import type { Deal, Mt5Account, PendingOrder, Position, TradeData } from "@/lib/mt5Api";
import { COLORS, STALE_SECONDS, dealNet, fmtLot, fmtPnl, fmtPx, isStale, orderLabel, positionPnl, sideLabel, totalPnl, tradeLines } from "./format";

const account = { id: "S:1", server: "S", broker: "B", login: 1, name: "n", mode: "demo", currency: "USD", leverage: 500, online: true, active: true, seen: 1 } as Mt5Account;
const pos = (o: Partial<Position> = {}): Position => ({
  ticket: 1, symbol: "XAUUSDm", type: "buy", volume: 0.1, price_open: 4100.5, sl: 4090, tp: 4120, price_current: 4105, profit: 47.5, swap: -0.5, time: 1, magic: 0, comment: "", ...o,
});
const ord = (o: Partial<PendingOrder> = {}): PendingOrder => ({
  ticket: 2, symbol: "XAUUSDm", type: "buy_limit", volume: 0.2, price_open: 4080, price_stoplimit: 0, sl: 0, tp: 4150, time_setup: 1, expiration: 0, magic: 0, comment: "", ...o,
});
const data = (o: Partial<TradeData> = {}): TradeData => ({ account, positions: [pos()], orders: [ord()], deals: [], updated_at: 1000, ...o });

describe("format", () => {
  it("lot: tối thiểu 2 chữ số, tới 8 khi cần", () => {
    expect(fmtLot(0.1)).toBe("0.10");
    expect(fmtLot(1)).toBe("1.00");
    expect(fmtLot(0.001)).toBe("0.001");
    expect(fmtLot(12.345)).toBe("12.345");
  });

  it("giá: theo digits của symbol; không biết thì bỏ số 0 thừa; 0 = không đặt → —", () => {
    expect(fmtPx(4100.5, 2)).toBe("4100.50");
    expect(fmtPx(1.1, undefined)).toBe("1.1");
    expect(fmtPx(1.123456789, undefined)).toBe("1.12346");
    expect(fmtPx(0, 2, true)).toBe("—");
    expect(fmtPx(0, 2)).toBe("0.00");
  });

  it("P/L có dấu và dấu phẩy ngàn", () => {
    expect(fmtPnl(47.5)).toBe("+47.50");
    expect(fmtPnl(-1234.5)).toBe("-1,234.50");
    expect(fmtPnl(0)).toBe("0.00");
  });

  it("nhãn", () => {
    expect(sideLabel("buy")).toBe("Buy");
    expect(sideLabel("balance")).toBe("Balance");
    expect(orderLabel("sell_stop_limit")).toBe("Sell stop limit");
    expect(orderLabel("other")).toBe("Order");
  });

  it("P/L vị thế = profit + swap; tổng; lãi/lỗ deal gồm cả phí", () => {
    expect(positionPnl(pos())).toBe(47);
    expect(totalPnl([pos(), pos({ ticket: 3, profit: -10, swap: 0 })])).toBe(37);
    expect(totalPnl([])).toBe(0);
    expect(dealNet({ profit: 10, commission: -0.7, swap: -0.1 } as Deal)).toBeCloseTo(9.2);
  });
});

describe("isStale", () => {
  it("cũ khi không có dữ liệu, account offline, hoặc EA lâu chưa báo / chưa báo lần nào", () => {
    expect(isStale(null, 1000)).toBe(true);
    expect(isStale(data(), 1000)).toBe(false);
    expect(isStale(data(), 1000 + STALE_SECONDS)).toBe(false);
    expect(isStale(data(), 1000 + STALE_SECONDS + 1)).toBe(true);
    expect(isStale(data({ account: { ...account, online: false } }), 1000)).toBe(true);
    expect(isStale(data({ updated_at: null }), 1000)).toBe(true);
  });
});

describe("tradeLines", () => {
  it("vị thế: entry (buy xanh dương / sell cam) kèm lot + P/L, SL đỏ, TP xanh lá; bỏ SL/TP = 0", () => {
    const l = tradeLines(data({ orders: [] }), "XAUUSDm", 1000);
    expect(l).toEqual([
      { key: "p:1", price: 4100.5, color: COLORS.buy, dashed: false, title: "BUY 0.10  +47.00" },
      { key: "psl:1", price: 4090, color: COLORS.sl, dashed: true, title: "SL" },
      { key: "ptp:1", price: 4120, color: COLORS.tp, dashed: true, title: "TP" },
    ]);
    const s = tradeLines(data({ positions: [pos({ type: "sell", sl: 0, tp: 0, profit: -3, swap: 0 })], orders: [] }), "XAUUSDm", 1000);
    expect(s).toEqual([{ key: "p:1", price: 4100.5, color: COLORS.sell, dashed: false, title: "SELL 0.10  -3.00" }]);
  });

  it("lệnh chờ: đường giá + TP; chỉ đúng symbol của chart", () => {
    const l = tradeLines(data({ positions: [] }), "XAUUSDm", 1000);
    expect(l.map((x) => x.key)).toEqual(["o:2", "otp:2"]);
    expect(l[0].title).toBe("BUY LIMIT 0.20");
    expect(tradeLines(data(), "EURUSD", 1000)).toEqual([]);
    expect(tradeLines(data({ positions: [pos({ symbol: "EURUSD" })], orders: [] }), "XAUUSDm", 1000)).toEqual([]);
  });

  it("lệnh chờ đang kéo: giá xem trước + nhãn loại mới, lệnh khác và SL/TP không đổi", () => {
    const l = tradeLines(data({ positions: [] }), "XAUUSDm", 1000, { ticket: 2, price: 4150.5, label: "Buy stop" });
    expect(l[0]).toMatchObject({ key: "o:2", price: 4150.5, title: "BUY STOP 0.20" });
    expect(l[1]).toMatchObject({ key: "otp:2", price: 4150 }); // TP không đi theo
    const other = tradeLines(data({ positions: [] }), "XAUUSDm", 1000, { ticket: 99, price: 1, label: "Sell stop" });
    expect(other[0]).toMatchObject({ price: 4080, title: "BUY LIMIT 0.20" }); // ticket khác: không ảnh hưởng
  });

  it("dữ liệu cũ hoặc không có → không vẽ đường nào (tránh đường vị thế đã đóng)", () => {
    expect(tradeLines(null, "XAUUSDm", 1000)).toEqual([]);
    expect(tradeLines(data(), "XAUUSDm", 5000)).toEqual([]);
    expect(tradeLines(data({ account: { ...account, online: false } }), "XAUUSDm", 1000)).toEqual([]);
  });

  it("loại lạ ('other') bị bỏ; lệnh chờ giá 0 bị bỏ", () => {
    expect(tradeLines(data({ positions: [pos({ type: "other" })], orders: [ord({ price_open: 0 })] }), "XAUUSDm", 1000)).toEqual([]);
  });
});
