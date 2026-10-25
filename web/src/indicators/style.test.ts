import { describe, expect, it } from "vitest";
import { byId } from "./catalog";
import { newInstance } from "./instance";
import { alphaOf, fillShown, fillStyle, itemStyle, itemStyles, levelStyle, plotStyle, withAlpha } from "./style";

describe("style hiệu lực", () => {
  const rsi = byId("rsi");
  const inst = newInstance("rsi");

  it("mặc định theo def", () => {
    expect(plotStyle(inst, rsi.plots[0])).toEqual({ color: "#7e57c2", colorDown: "#7e57c2", width: 1, lineStyle: "solid", type: "line", visible: true });
    expect(levelStyle(inst, rsi.levels![0])).toEqual({ value: 70, color: "#787b86", width: 1, lineStyle: "dashed", visible: true });
    expect(fillStyle(inst, rsi.fills![0])).toEqual({ color: "#7e57c21a", colorDown: "#7e57c21a", visible: true });
  });

  it("phần user đặt thắng mặc định; plot perBar giữ kiểu của def", () => {
    const i = { ...inst, style: { plots: { rsi: { width: 3, type: "area" as const } }, levels: { upper: { value: 75 } } } };
    expect(plotStyle(i, rsi.plots[0])).toMatchObject({ width: 3, type: "area" });
    expect(levelStyle(i, rsi.levels![0]).value).toBe(75);
    const macd = byId("macd");
    const m = { ...newInstance("macd"), style: { plots: { hist: { type: "line" as const } } } };
    expect(plotStyle(m, macd.plots.find((p) => p.id === "hist")!).type).toBe("histogram");
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

describe("fill hai màu", () => {
  const ich = byId("ichimoku");
  it("mặc định xanh/đỏ theo def; user đổi từng màu độc lập", () => {
    const f = ich.fills![0];
    expect(fillStyle(newInstance("ichimoku"), f)).toEqual({ color: "#43a0471a", colorDown: "#f443361a", visible: true });
    const i = { ...newInstance("ichimoku"), style: { fills: { cloud: { colorDown: "#123456" } } } };
    expect(fillStyle(i, f)).toMatchObject({ color: "#43a0471a", colorDown: "#123456" });
  });
});

describe("style của items", () => {
  const piv = byId("pivots");
  it("mặc định theo def, user đặt thắng", () => {
    const r1 = piv.items!.find((i) => i.id === "R1")!;
    expect(itemStyle(newInstance("pivots"), r1)).toEqual({ color: "#fb8c00", visible: true, width: 1, style: "solid" }); // TV: mọi mức #fb8c00
    const i = { ...newInstance("pivots"), style: { items: { R1: { color: "#111111", width: 2, lineStyle: "dotted" as const, visible: false as const } } } };
    expect(itemStyle(i, r1)).toEqual({ color: "#111111", visible: false, width: 2, style: "dotted" });
    expect(Object.keys(itemStyles(newInstance("pivots"), piv))).toHaveLength(11);
  });
});
