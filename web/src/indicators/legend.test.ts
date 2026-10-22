import { describe, expect, it } from "vitest";
import { byId } from "./catalog";
import { newInstance } from "./instance";
import { fmtPlotValue, legendDigits, visiblePlotValues } from "./legend";

describe("legend", () => {
  it("số chữ số: overlay theo giá, pane riêng 2, user đặt thì thắng", () => {
    expect(legendDigits(newInstance("sma"), byId("sma"), 3)).toBe(3);
    expect(legendDigits(newInstance("rsi"), byId("rsi"), 3)).toBe(2);
    expect(legendDigits({ ...newInstance("sma"), precision: 0 }, byId("sma"), 3)).toBe(0);
  });

  it("định dạng: dấu phẩy ngàn, dấu trừ Unicode, na", () => {
    expect(fmtPlotValue(4131.155, 3)).toBe("4,131.155");
    expect(fmtPlotValue(-1.934, 2)).toBe("−1.93");
    expect(fmtPlotValue(-0.001, 2)).toBe("0.00"); // làm tròn về 0 thì không có dấu trừ
    expect(fmtPlotValue(NaN, 2)).toBe("∅");
    expect(fmtPlotValue(36.894, 0)).toBe("37");
  });

  it("bỏ plot đã tắt trong Style", () => {
    const vals = [
      { id: "macd", title: "MACD", value: 1, color: "#fff" },
      { id: "signal", title: "Signal", value: 2, color: "#fff" },
    ];
    const inst = { ...newInstance("macd"), style: { plots: { signal: { visible: false } } } };
    expect(visiblePlotValues(inst, vals).map((v) => v.id)).toEqual(["macd"]);
    expect(visiblePlotValues(inst, undefined)).toEqual([]);
  });
});
