import { describe, expect, it } from "vitest";
import type { SymbolInfo } from "@/lib/api";
import { estimatePnl, fmtPnlCcy, pnlSpec, pointsBetween, priceForPnl, priceFromPoints, stopDir, stopTitle, type PnlSpec } from "./pnl";

// Vàng: tick 0.001, mỗi tick 1 lot = 0.1 USD (100 oz × 0.001)
const GOLD: PnlSpec = { tickSize: 0.001, tickValue: 0.1, tickValueLoss: 0.1 };
const sym = (o: Partial<SymbolInfo> = {}) => ({ name: "X", digits: 3, tick_size: 0.001, type: "metal", tick_value: 0.1, ...o }) as SymbolInfo;

describe("pnlSpec", () => {
  it("cần tick_size và tick_value; tick_value_loss thiếu thì dùng tick_value", () => {
    expect(pnlSpec(sym())).toEqual(GOLD);
    expect(pnlSpec(sym({ tick_value_loss: 0.12 }))?.tickValueLoss).toBe(0.12);
  });
  it("EA cũ chưa báo tick_value → null (không đoán lãi/lỗi)", () => {
    expect(pnlSpec(undefined)).toBeNull();
    expect(pnlSpec(sym({ tick_value: null }))).toBeNull();
    expect(pnlSpec(sym({ tick_value: 0 }))).toBeNull();
    expect(pnlSpec(sym({ tick_size: 0 }))).toBeNull();
  });
});

describe("estimatePnl", () => {
  it("Buy lãi khi giá lên, lỗ khi giá xuống", () => {
    expect(estimatePnl("buy", 1, 4000, 4010, GOLD)).toBeCloseTo(1000); // 10 / 0.001 tick × 0.1
    expect(estimatePnl("buy", 0.1, 4000, 3990, GOLD)).toBeCloseTo(-100);
  });
  it("Sell ngược lại", () => {
    expect(estimatePnl("sell", 1, 4000, 3990, GOLD)).toBeCloseTo(1000);
    expect(estimatePnl("sell", 0.01, 4000, 4010, GOLD)).toBeCloseTo(-10);
  });
  it("lãi dùng tick_value, lỗ dùng tick_value_loss (cặp chéo hai giá trị khác nhau)", () => {
    const s = { ...GOLD, tickValueLoss: 0.2 };
    expect(estimatePnl("buy", 1, 4000, 4001, s)).toBeCloseTo(100);
    expect(estimatePnl("buy", 1, 4000, 3999, s)).toBeCloseTo(-200);
  });
  it("tại giá vào thì bằng 0", () => {
    expect(estimatePnl("buy", 1, 4000, 4000, GOLD)).toBeCloseTo(0);
  });
});

describe("priceForPnl", () => {
  it("ngược lại của estimatePnl (khứ hồi)", () => {
    for (const [side, amount] of [["buy", 50], ["buy", -20], ["sell", 75.5], ["sell", -8]] as const) {
      const p = priceForPnl(side, 0.1, 4000, amount, GOLD)!;
      expect(estimatePnl(side, 0.1, 4000, p, GOLD)).toBeCloseTo(amount, 6);
    }
  });
  it("lãi Buy ở trên giá vào, lỗ Buy ở dưới; Sell ngược lại", () => {
    expect(priceForPnl("buy", 1, 4000, 100, GOLD)!).toBeGreaterThan(4000);
    expect(priceForPnl("buy", 1, 4000, -100, GOLD)!).toBeLessThan(4000);
    expect(priceForPnl("sell", 1, 4000, 100, GOLD)!).toBeLessThan(4000);
  });
  it("lot không hợp lệ / số không hợp lệ → null", () => {
    expect(priceForPnl("buy", 0, 4000, 10, GOLD)).toBeNull();
    expect(priceForPnl("buy", 1, 4000, NaN, GOLD)).toBeNull();
  });
});

describe("điểm và hướng", () => {
  it("pointsBetween theo digits", () => {
    expect(pointsBetween(4000, 4010.5, 3)).toBe(10500);
    expect(pointsBetween(1.1, 1.0995, 5)).toBe(50);
  });
  it("SL của Buy và TP của Sell nằm dưới; TP của Buy và SL của Sell nằm trên", () => {
    expect(stopDir("sl", "buy")).toBe(-1);
    expect(stopDir("tp", "sell")).toBe(-1);
    expect(stopDir("tp", "buy")).toBe(1);
    expect(stopDir("sl", "sell")).toBe(1);
  });
  it("priceFromPoints đi đúng phía", () => {
    expect(priceFromPoints(4000, 1000, "sl", "buy", 3)).toBeCloseTo(3999);
    expect(priceFromPoints(4000, 1000, "tp", "buy", 3)).toBeCloseTo(4001);
    expect(priceFromPoints(4000, 1000, "sl", "sell", 3)).toBeCloseTo(4001);
  });
});

describe("nhãn", () => {
  it("fmtPnlCcy có dấu và tiền tệ", () => {
    expect(fmtPnlCcy(78.3, "USD")).toBe("+78.30 USD");
    expect(fmtPnlCcy(-12.4, "USD")).toBe("-12.40 USD");
    expect(fmtPnlCcy(5, "")).toBe("+5.00");
  });
  it("stopTitle: SL ra số lỗ, TP ra số lãi; thiếu tick_value hoặc giá vào thì chỉ có tên", () => {
    expect(stopTitle("sl", "buy", 0.1, 4000, 3990, GOLD, "USD")).toBe("SL -100.00 USD");
    expect(stopTitle("tp", "buy", 0.1, 4000, 4010, GOLD, "USD")).toBe("TP +100.00 USD");
    expect(stopTitle("tp", "sell", 0.1, 4000, 3990, GOLD, "USD")).toBe("TP +100.00 USD");
    expect(stopTitle("sl", "buy", 0.1, 4000, 3990, null, "USD")).toBe("SL");
    expect(stopTitle("sl", "buy", 0.1, 0, 3990, GOLD, "USD")).toBe("SL");
    expect(stopTitle("sl", "buy", 0, 4000, 3990, GOLD, "USD")).toBe("SL");
  });
});
