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

  it("định dạng volume: K / M / B, âm, dưới 1000", () => {
    expect(fmtPlotValue(1150, 2, true)).toBe("1.15K");
    expect(fmtPlotValue(-1110, 2, true)).toBe("−1.11K");
    expect(fmtPlotValue(-817, 2, true)).toBe("−817");
    expect(fmtPlotValue(2_300_000, 1, true)).toBe("2.3M");
    expect(fmtPlotValue(3e9, 2, true)).toBe("3.00B");
    expect(fmtPlotValue(0, 2, true)).toBe("0");
    expect(fmtPlotValue(NaN, 2, true)).toBe("∅");
  });

  it("bỏ plot đã tắt trong Style", () => {
    const vals = [
      { id: "macd", plot: "macd", title: "MACD", value: 1, color: "#fff" },
      { id: "signal", plot: "signal", title: "Signal", value: 2, color: "#fff" },
      { id: "hist.o", plot: "hist", title: "O", value: 3, color: "#fff" },
    ];
    const inst = { ...newInstance("macd"), style: { plots: { signal: { visible: false } } } };
    expect(visiblePlotValues(inst, vals).map((v) => v.id)).toEqual(["macd", "hist.o"]);
    const noHist = { ...inst, style: { plots: { hist: { visible: false as const } } } };
    expect(visiblePlotValues(noHist, vals).map((v) => v.id)).toEqual(["macd", "signal"]); // plot candles: 4 giá trị cùng ẩn/hiện
    expect(visiblePlotValues(inst, undefined)).toEqual([]);
  });
});
