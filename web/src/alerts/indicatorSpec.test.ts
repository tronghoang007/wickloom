import { describe, expect, it } from "vitest";
import { ALERT_PLOTS, alertPlots, defaultLevel, indicatorLabel, levelChoices, plotTitle, smoothingHint, specFromInstance, supportsIndicatorAlert, vsOptions, vsText, withChoice } from "./indicatorSpec";
import { byId, INDICATORS } from "@/indicators/catalog";

describe("ALERT_PLOTS", () => {
  it("only lists indicators and plots the catalog really has", () => {
    for (const [id, plots] of Object.entries(ALERT_PLOTS)) {
      const def = INDICATORS.find((d) => d.id === id);
      expect(def, id).toBeDefined();
      for (const p of plots) expect(def!.plots.map((x) => x.id), `${id}.${p}`).toContain(p);
    }
  });

  it("names the plots like the indicator does", () => {
    expect(alertPlots("macd")).toEqual([{ id: "macd", title: "MACD" }, { id: "signal", title: "Signal" }, { id: "hist", title: "Histogram" }]);
    expect(plotTitle("rsi", "sm")).toBe("RSI-based MA");
    expect(supportsIndicatorAlert("rsi") && !supportsIndicatorAlert("cvd") && !supportsIndicatorAlert("atr")).toBe(true);
  });
});

describe("specFromInstance", () => {
  it("starts from the most common use of each indicator", () => {
    expect(specFromInstance({ id: "rsi", inputs: {} })).toMatchObject({ id: "rsi", plot: "rsi", vs: "level", label: "RSI 14 close" });
    expect(specFromInstance({ id: "macd", inputs: {} })).toMatchObject({ plot: "macd", vs: "signal", vs_label: "Signal", label: "MACD close 12 26 9 EMA EMA" });
    expect(specFromInstance({ id: "ema", inputs: { length: 50 } })).toMatchObject({ plot: "ema", vs: "price", label: "EMA 50 close", vs_label: "Price" });
    expect(specFromInstance({ id: "bb", inputs: {} })).toMatchObject({ plot: "upper", vs: "price", label: "Bollinger Bands 20 SMA close 2 · Upper" });
    expect(specFromInstance({ id: "stoch", inputs: {} })).toMatchObject({ plot: "k", vs: "d", label: "Stochastic 14 1 3 · %K" });
  });

  it("carries every input, with the defaults filled in", () => {
    const s = specFromInstance({ id: "rsi", inputs: { length: 7 } })!;
    expect(s.inputs).toMatchObject({ length: 7, src: "close", smoothType: "SMA", smoothLength: 14 });
    expect(s.label).toBe("RSI 7 close");
  });

  it("is null for an indicator without alerts", () => {
    expect(specFromInstance({ id: "cvd", inputs: {} })).toBeNull();
    expect(specFromInstance({ id: "nope", inputs: {} })).toBeNull();
  });

  it("works for every supported indicator", () => {
    for (const id of Object.keys(ALERT_PLOTS)) {
      const s = specFromInstance({ id, inputs: {} })!;
      expect(ALERT_PLOTS[id]).toContain(s.plot);
      expect(s.vs === "level" || s.vs === "price" || ALERT_PLOTS[id].includes(s.vs), id).toBe(true);
      expect(s.vs).not.toBe(s.plot);
    }
  });
});

describe("choices", () => {
  it("offers a value, the price and the other lines of the indicator", () => {
    expect(vsOptions({ id: "macd", plot: "macd" }).map((o) => o.value)).toEqual(["level", "price", "signal", "hist"]);
    expect(vsOptions({ id: "wma", plot: "wma" }).map((o) => o.value)).toEqual(["level", "price"]);
  });

  it("rebuilds the label and never compares a line with itself", () => {
    const base = specFromInstance({ id: "macd", inputs: {} })!;
    const s = withChoice(base, "signal", "macd");
    expect(s).toMatchObject({ plot: "signal", vs: "macd", vs_label: "MACD", label: "MACD close 12 26 9 EMA EMA · Signal" });
    expect(withChoice(base, "signal", "signal")).toMatchObject({ plot: "signal", vs: "price", vs_label: "Price" });
    expect(withChoice(base, "macd", "level")).toMatchObject({ vs: "level", vs_label: "" });
  });

  it("names what a line is compared with", () => {
    expect(vsText({ id: "rsi", vs: "level" })).toBe("Value");
    expect(vsText({ id: "rsi", vs: "price" })).toBe("Price");
    expect(vsText({ id: "macd", vs: "signal" })).toBe("Signal");
    expect(vsText({ id: "macd", vs: "signal", vs_label: "Sig" })).toBe("Sig");
  });

  it("suggests the horizontal lines of the indicator", () => {
    expect(levelChoices("rsi")).toEqual([70, 50, 30]);
    expect(defaultLevel("rsi")).toBe(70);
    expect(defaultLevel("stoch")).toBe(80);
    expect(defaultLevel("macd")).toBe(0); // đường 0 của MACD
    expect(defaultLevel("sma")).toBeNull();
  });
});

describe("indicatorLabel", () => {
  it("shows the plot only when it is not the indicator's own", () => {
    expect(indicatorLabel("rsi", {}, "rsi")).toBe("RSI 14 close");
    expect(indicatorLabel("rsi", {}, "sm")).toBe("RSI 14 close · RSI-based MA");
    expect(byId("rsi").name).toBe("RSI");
  });
});

describe("smoothingHint", () => {
  const inputs = (smoothType: string) => ({ smoothType });
  it("warns when a Smoothing line is chosen but Smoothing cannot produce it", () => {
    expect(smoothingHint({ inputs: inputs("None"), plot: "sm", vs: "level" })).toContain("Smoothing");
    expect(smoothingHint({ inputs: inputs("None"), plot: "sma", vs: "sm" })).toContain("Smoothing");
    expect(smoothingHint({ inputs: inputs("SMA"), plot: "smUpper", vs: "price" })).toContain("Bollinger");
  });

  it("is quiet otherwise", () => {
    expect(smoothingHint({ inputs: inputs("None"), plot: "rsi", vs: "level" })).toBeNull();
    expect(smoothingHint({ inputs: inputs("SMA"), plot: "sm", vs: "level" })).toBeNull();
    expect(smoothingHint({ inputs: inputs("SMA + Bollinger Bands"), plot: "smLower", vs: "price" })).toBeNull();
  });
});
