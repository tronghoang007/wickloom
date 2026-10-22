import { describe, expect, it } from "vitest";
import { byId } from "./catalog";
import { newInstance } from "./instance";
import { alphaOf, fillShown, fillStyle, levelStyle, plotStyle, withAlpha } from "./style";

describe("style hiệu lực", () => {
  const rsi = byId("rsi");
  const inst = newInstance("rsi");

  it("mặc định theo def", () => {
    expect(plotStyle(inst, rsi.plots[0])).toEqual({ color: "#7e57c2", width: 1, lineStyle: "solid", type: "line", visible: true });
    expect(levelStyle(inst, rsi.levels![0])).toEqual({ value: 70, color: "#787b86", width: 1, lineStyle: "dashed", visible: true });
    expect(fillStyle(inst, rsi.fills![0])).toEqual({ color: "#7e57c21a", visible: true });
  });

  it("phần user đặt thắng mặc định; plot perBar giữ kiểu của def", () => {
    const i = { ...inst, style: { plots: { rsi: { width: 3, type: "area" as const } }, levels: { upper: { value: 75 } } } };
    expect(plotStyle(i, rsi.plots[0])).toMatchObject({ width: 3, type: "area" });
    expect(levelStyle(i, rsi.levels![0]).value).toBe(75);
    const macd = byId("macd");
    const m = { ...newInstance("macd"), style: { plots: { hist: { type: "line" as const } } } };
    expect(plotStyle(m, macd.plots[2]).type).toBe("histogram");
  });

  it("fill chỉ vẽ khi chưa tắt và hai đầu còn hiện", () => {
    const bb = byId("bb");
    const base = newInstance("bb");
    expect(fillShown(base, bb, bb.fills![0])).toBe(true);
    expect(fillShown({ ...base, style: { fills: { band: { visible: false } } } }, bb, bb.fills![0])).toBe(false);
    expect(fillShown({ ...base, style: { plots: { upper: { visible: false } } } }, bb, bb.fills![0])).toBe(false);
    expect(fillShown({ ...inst, style: { levels: { lower: { visible: false } } } }, rsi, rsi.fills![0])).toBe(false);
    expect(fillShown(inst, rsi, rsi.fills![0])).toBe(true);
  });

  it("withAlpha / alphaOf", () => {
    expect(withAlpha("#2962ff", 0.5)).toBe("#2962ff80");
    expect(withAlpha("#2962ff33", 1)).toBe("#2962ffff");
    expect(withAlpha("red", 0.5)).toBe("red");
    expect(alphaOf("#2962ff80")).toBeCloseTo(0.5, 1);
    expect(alphaOf("#2962ff")).toBe(1);
  });
});
