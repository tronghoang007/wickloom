import { describe, expect, it } from "vitest";
import type { PendingOrder, Position, TradeData } from "@/lib/mt5Api";
import { filledAs } from "./filled";

const order = (ticket: number) => ({ ticket, symbol: "XAUUSDm", type: "buy_limit", volume: 1, price_open: 100, sl: 0, tp: 0 }) as PendingOrder;
const position = (ticket: number) => ({ ticket, symbol: "XAUUSDm", type: "buy", volume: 1, price_open: 100, sl: 0, tp: 0 }) as Position;
const data = (orders: PendingOrder[], positions: Position[]) => ({ orders, positions, deals: [], updated_at: 1 }) as unknown as TradeData;

describe("filledAs (lệnh chờ vừa khớp)", () => {
  it("lệnh biến mất và vị thế cùng ticket xuất hiện → chủ lệnh mới là vị thế", () => {
    expect(filledAs("order:7", data([], [position(7)]))).toBe("position:7");
  });
  it("lệnh vẫn còn chờ → chưa khớp", () => {
    expect(filledAs("order:7", data([order(7)], []))).toBeNull();
    expect(filledAs("order:7", data([order(7)], [position(7)]))).toBeNull();
  });
  it("lệnh biến mất mà không có vị thế cùng ticket (huỷ / hết hạn) → null", () => {
    expect(filledAs("order:7", data([], []))).toBeNull();
    expect(filledAs("order:7", data([], [position(8)]))).toBeNull();
  });
  it("chủ lệnh đã là vị thế hoặc bản nháp → null", () => {
    expect(filledAs("position:7", data([], [position(7)]))).toBeNull();
    expect(filledAs("draft", data([], []))).toBeNull();
  });
});
