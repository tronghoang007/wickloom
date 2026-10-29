import { describe, expect, it } from "vitest";
import type { SymbolInfo } from "@/lib/api";
import type { Mt5Account, Position, TradeData } from "@/lib/mt5Api";
import { liveTrade } from "./live";
import { dealSummary, todayStart } from "./format";
import { SIM_ACCOUNT_ID } from "./simId";

// Số trong ảnh user 10-29: Buy 0.02 XAUUSDm, EA báo +3.27 ở 4026.402; account (chụp trước đó) profit 3.97, equity 106.46, balance 102.49, margin 4.02
const account = { id: "S:1", server: "S", broker: "B", login: 1, name: "n", mode: "demo", currency: "USD", leverage: 2000, online: true, active: true, seen: 1, balance: 102.49, equity: 106.46, profit: 3.97, margin: 4.02, margin_free: 102.44, margin_level: 2648.26 } as Mt5Account;
const pos = (o: Partial<Position> = {}): Position => ({
  ticket: 1, symbol: "XAUUSDm", type: "buy", volume: 0.02, price_open: 4024.766, sl: 0, tp: 0, price_current: 4026.402, profit: 3.27, swap: 0, time: 1, magic: 0, comment: "", ...o,
});
const data = (o: Partial<TradeData> = {}): TradeData => ({ account, positions: [pos()], orders: [], deals: [], updated_at: 1000, ...o });
const gold: SymbolInfo = { name: "XAUUSDm", digits: 3, tick_size: 0.001, type: "forex", contract_size: 100, tick_value: 0.1, tick_value_loss: 0.1 };

describe("liveTrade", () => {
  it("lãi vị thế theo tick mới: số MT5 + quãng giá từ price_current tới Bid (Buy)", () => {
    const d = liveTrade(data(), { XAUUSDm: { bid: 4026.75, ask: 4026.9 } }, [gold])!;
    // 348 tick × 0.1 × 0.02 lot = 0.696 → 3.27 + 0.70
    expect(d.positions[0].price_current).toBe(4026.75);
    expect(d.positions[0].profit).toBe(3.97);
  });

  it("Sell đóng ở Ask", () => {
    const d = liveTrade(data({ positions: [pos({ type: "sell", price_open: 4026.1, price_current: 4026.9, profit: -1.6 })] }), { XAUUSDm: { bid: 4026.5, ask: 4026.6 } }, [gold])!;
    expect(d.positions[0].price_current).toBe(4026.6);
    expect(d.positions[0].profit).toBe(-1); // (4026.1 - 4026.6) × 100 × 0.02
  });

  it("symbol tính bằng đồng tiền account: tính thẳng từ giá mở như MT5, không cộng dồn lên số đã làm tròn", () => {
    // MT5: 0.004 × 100 × 0.01 = 0.004 → 0.00; tick mới 4000.009 → 0.009 → 0.01 (cộng dồn: 0.00 + 0.005 → 0.00, lệch MT5)
    const p = pos({ volume: 0.01, price_open: 4000, price_current: 4000.004, profit: 0 });
    expect(liveTrade(data({ positions: [p] }), { XAUUSDm: { bid: 4000.009, ask: 4000.2 } }, [gold])!.positions[0].profit).toBe(0.01);
    // nửa xa số 0 như MT5: -0.125 → -0.13
    const s = pos({ type: "sell", volume: 0.01, price_open: 4000, price_current: 4000.1, profit: -0.1 });
    expect(liveTrade(data({ positions: [s] }), { XAUUSDm: { bid: 4000, ask: 4000.125 } }, [gold])!.positions[0].profit).toBe(-0.13);
  });

  it("cặp lãi bằng đồng khác account: cộng quãng giá vào số MT5 theo tick value MT5 báo", () => {
    const eurgbp: SymbolInfo = { name: "EURGBPm", digits: 5, tick_size: 0.00001, type: "forex", contract_size: 100000, tick_value: 1.33, tick_value_loss: 1.33 };
    const p = pos({ symbol: "EURGBPm", volume: 0.1, price_open: 0.85, price_current: 0.851, profit: 13.3 });
    const d = liveTrade(data({ positions: [p] }), { EURGBPm: { bid: 0.8512, ask: 0.8513 } }, [eurgbp])!;
    expect(d.positions[0].profit).toBe(15.96); // 13.3 + 20 tick × 1.33 × 0.1
  });

  it("account tính lại từ vị thế: Unrealized = tổng vị thế (không lệch với hàng vị thế), Equity / Free margin / Margin level theo đó", () => {
    const d = liveTrade(data(), {}, [gold])!; // chưa có tick: vị thế giữ số MT5 nhưng header vẫn khớp hàng vị thế
    expect(d.positions[0].profit).toBe(3.27);
    expect(d.account.profit).toBe(3.27);
    expect(d.account.equity).toBe(105.76); // 102.49 + 3.27
    expect(d.account.margin_free).toBe(101.74);
    expect(d.account.margin_level).toBeCloseTo((105.76 / 4.02) * 100, 6);
  });

  it("giá trong kho đã cũ (không còn tick) thì giữ số MT5", () => {
    const d = liveTrade(data(), { XAUUSDm: { bid: 4000, ask: 4000.2 } }, [gold], () => false)!;
    expect(d.positions[0].profit).toBe(3.27);
    expect(d.positions[0].price_current).toBe(4026.402);
  });

  it("giữ nguyên khi: không có vị thế, sổ giả lập Replay, symbol thiếu thông số tick", () => {
    const empty = data({ positions: [] });
    expect(liveTrade(empty, { XAUUSDm: { bid: 1, ask: 2 } }, [gold])).toBe(empty);
    const sim = data({ account: { ...account, id: SIM_ACCOUNT_ID } });
    expect(liveTrade(sim, { XAUUSDm: { bid: 4030, ask: 4030.1 } }, [gold])).toBe(sim);
    const d = liveTrade(data(), { XAUUSDm: { bid: 4030, ask: 4030.1 } }, [{ ...gold, tick_value: null, contract_size: null }])!;
    expect(d.positions[0].profit).toBe(3.27);
  });
});

describe("Profit hôm nay (tab Account, như History của MT5)", () => {
  it("chỉ deal từ 0h hôm nay (giờ máy); Profit là lãi gộp các lệnh đã đóng, Swap / Commission tách riêng", () => {
    const midnight = new Date(2026, 9, 29).getTime() / 1000;
    const now = midnight + 20 * 3600;
    expect(todayStart(now)).toBe(midnight);
    const deal = (time: number, profit: number, commission = 0, swap = 0) =>
      ({ ticket: time, order: 0, symbol: "XAUUSDm", type: "sell", entry: "out", volume: 0.01, price: 1, profit, commission, swap, time, magic: 0, comment: "", position: 1 }) as TradeData["deals"][number];
    const deals = [deal(midnight - 60, 5), deal(midnight + 60, 1.85, -0.1, -0.05), deal(now - 10, 0.64)];
    const sum = dealSummary(deals.filter((d) => d.time >= todayStart(now)));
    expect(sum.profit).toBeCloseTo(2.49, 6);
    expect(sum.commission).toBeCloseTo(-0.1, 6);
    expect(sum.swap).toBeCloseTo(-0.05, 6);
  });
});
