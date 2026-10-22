import { describe, expect, it } from "vitest";
import { mergeCandleColors, overridePoint, planCandleColors } from "./candleColors";

describe("mergeCandleColors", () => {
  it("không indicator nào tô thì null", () => {
    expect(mergeCandleColors([])).toBeNull();
    expect(mergeCandleColors([null, null])).toBeNull();
  });
  it("một indicator: giữ nguyên (và không sửa mảng gốc)", () => {
    const a = ["#f00", "", "#0f0"];
    const m = mergeCandleColors([null, a]);
    expect(m).toEqual(a);
    expect(m).not.toBe(a);
  });
  it("indicator đứng sau thắng ở nến nó có màu, nến nó bỏ trống giữ màu trước", () => {
    expect(mergeCandleColors([["#a", "#a", ""], ["", "#b", "#b"]])).toEqual(["#a", "#b", "#b"]);
  });
});

describe("planCandleColors", () => {
  it("không đổi: none", () => {
    expect(planCandleColors(null, null)).toEqual({ kind: "none" });
    expect(planCandleColors(["a", "b"], ["a", "b"])).toEqual({ kind: "none" });
  });
  it("bật / tắt hẳn: dựng lại cả series", () => {
    expect(planCandleColors(null, ["a"])).toEqual({ kind: "all" });
    expect(planCandleColors(["a"], null)).toEqual({ kind: "all" });
  });
  it("chỉ nến cuối đổi màu: tail", () => {
    expect(planCandleColors(["a", "b", "c"], ["a", "b", "x"])).toEqual({ kind: "tail", from: 2 });
  });
  it("thêm một nến mới: tail từ nến mới", () => {
    expect(planCandleColors(["a", "b"], ["a", "b", "c"])).toEqual({ kind: "tail", from: 2 });
    expect(planCandleColors(["a", "b"], ["a", "b", ""])).toEqual({ kind: "tail", from: 2 });
  });
  it("đổi ở giữa hoặc ngắn đi: all", () => {
    expect(planCandleColors(["a", "b", "c"], ["a", "x", "c"])).toEqual({ kind: "all" });
    expect(planCandleColors(["a", "b", "c"], ["a", "b"])).toEqual({ kind: "all" });
  });
});

describe("overridePoint", () => {
  const candle = { time: 1, open: 1, high: 3, low: 0, close: 2 };
  it("nến: thân + viền + bấc cùng màu", () => {
    expect(overridePoint(candle, "candles", "#f00", true)).toMatchObject({ color: "#f00", borderColor: "#f00", wickColor: "#f00", close: 2 });
    expect(overridePoint(candle, "heikin", "#f00", true)).toMatchObject({ color: "#f00" });
  });
  it("nến rỗng (thân tắt): thân vẫn trong suốt, viền/bấc có màu", () => {
    expect(overridePoint(candle, "candles", "#f00", false)).toMatchObject({ color: "rgba(0,0,0,0)", borderColor: "#f00", wickColor: "#f00" });
  });
  it("bar: color; line: color; area: lineColor", () => {
    expect(overridePoint(candle, "bars", "#f00", true)).toMatchObject({ color: "#f00" });
    expect(overridePoint({ time: 1, value: 2 }, "line", "#f00", true)).toEqual({ time: 1, value: 2, color: "#f00" });
    expect(overridePoint({ time: 1, value: 2 }, "area", "#f00", true)).toEqual({ time: 1, value: 2, lineColor: "#f00" });
  });
  it("không sửa điểm gốc", () => {
    overridePoint(candle, "candles", "#f00", true);
    expect(candle).toEqual({ time: 1, open: 1, high: 3, low: 0, close: 2 });
  });
});
