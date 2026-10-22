import { beforeEach, describe, expect, it } from "vitest";
import { useQuoteStore } from "./quote";

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
