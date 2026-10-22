import { beforeEach, describe, expect, it } from "vitest";
import { spreadPips, splitPrice, useQuoteStore } from "./quote";

beforeEach(() => useQuoteStore.setState({ quotes: {} }));

describe("useQuoteStore", () => {
  it("lưu bid/ask theo symbol", () => {
    useQuoteStore.getState().set("XAUUSDm", 4131.1, 4131.3);
    useQuoteStore.getState().set("EURUSD", 1.1, 1.1001);
    expect(useQuoteStore.getState().quotes).toEqual({ XAUUSDm: { bid: 4131.1, ask: 4131.3 }, EURUSD: { bid: 1.1, ask: 1.1001 } });
  });
  it("tick thiếu một phía hoặc không phải số dương bị bỏ", () => {
    const { set } = useQuoteStore.getState();
    set("X", 0, 1.2);
    set("X", 1.1, 0);
    set("X", NaN, 1.2);
    expect(useQuoteStore.getState().quotes).toEqual({});
  });
  it("tick lặp không tạo state mới (khỏi render lại widget)", () => {
    useQuoteStore.getState().set("X", 1, 2);
    const before = useQuoteStore.getState().quotes;
    useQuoteStore.getState().set("X", 1, 2);
    expect(useQuoteStore.getState().quotes).toBe(before);
    useQuoteStore.getState().set("X", 1, 3);
    expect(useQuoteStore.getState().quotes).not.toBe(before);
  });
});

describe("spreadPips", () => {
  it("vàng 3 chữ số: 0.45 → 45.0 (như TV); forex 5 chữ số: 0.00012 → 1.2", () => {
    expect(spreadPips(4087.44, 4087.89, 3)).toBe("45.0");
    expect(spreadPips(1.0985, 1.09862, 5)).toBe("1.2");
  });
  it("symbol 2 / 4 chữ số tính theo điểm; không bao giờ âm", () => {
    expect(spreadPips(100, 100.5, 2)).toBe("50.0");
    expect(spreadPips(150.123, 150.12, 3)).toBe("0.0");
  });
});

describe("splitPrice", () => {
  it("tách pipette cho symbol 3 / 5 chữ số", () => {
    expect(splitPrice(4087.44, 3)).toEqual(["4,087.44", "0"]);
    expect(splitPrice(1.09862, 5)).toEqual(["1.0986", "2"]);
  });
  it("symbol khác giữ nguyên giá", () => {
    expect(splitPrice(67000.5, 2)).toEqual(["67,000.50", ""]);
  });
});
