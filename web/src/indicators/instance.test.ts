import { describe, expect, it } from "vitest";
import { byId } from "./catalog";
import { coerceInput, inputsText, instanceShown, migrateInstance, migrateInstances, newInstance, plotColor, plotShown, resolveInputs, showsPriceLabel, withPlotColor } from "./instance";

describe("resolveInputs", () => {
  const sma = byId("sma");

  it("thiếu / sai kiểu -> mặc định; số nguyên được làm tròn và chặn min", () => {
    expect(resolveInputs(sma, undefined)).toMatchObject({ length: 9, src: "close", offset: 0, smoothType: "None" }); // mặc định TV: length 9
    expect(resolveInputs(sma, { length: "20", src: "nope" })).toMatchObject({ length: 9, src: "close", offset: 0 });
    expect(resolveInputs(sma, { length: 9.6, src: "hl2" })).toMatchObject({ length: 10, src: "hl2", offset: 0 });
    expect(resolveInputs(sma, { length: -5, offset: 9999 })).toMatchObject({ length: 1, src: "close", offset: 500 });
  });

  it("bool và select", () => {
    const vwap = byId("vwap");
    expect(resolveInputs(vwap, { anchor: "Week" })).toMatchObject({ anchor: "Week", src: "hlc3", hideDWM: false, sessionStart: "After break", showBand1: true, showBand2: false, bandMult2: 2 });
    expect(resolveInputs(vwap, { anchor: "Decade" })).toMatchObject({ anchor: "Decade" });
    expect(resolveInputs(vwap, { anchor: "Epoch" })).toMatchObject({ anchor: "Session", src: "hlc3" });
    expect(coerceInput({ key: "k", label: "k", type: "bool", default: false }, true)).toBe(true);
    expect(coerceInput({ key: "k", label: "k", type: "bool", default: false }, 1)).toBeUndefined();
    expect(coerceInput({ key: "k", label: "k", type: "float", default: 1 }, NaN)).toBeUndefined();
  });
});

describe("migrateInstance", () => {
  it("dạng cũ {uid,id,inputs,colors[]}: colors[k] -> màu plot thứ k", () => {
    const m = migrateInstance({ uid: "u1", id: "bb", inputs: { length: 10, mult: 2.5, src: "close" }, colors: ["#111111", "#222222", "#333333"] });
    expect(m).toEqual({
      v: 2,
      uid: "u1",
      id: "bb",
      inputs: { length: 10, mult: 2.5, src: "close" },
      style: { plots: { basis: { color: "#111111" }, upper: { color: "#222222" }, lower: { color: "#333333" } }, fills: { band: { color: "#2196f31a" } } },
    });
  });

  it("instance cũ (v1) giữ mặc định trước khi đối chiếu TV, instance mới theo TV", () => {
    // user chưa đặt gì: SMA / EMA vẫn length 20, EMA vẫn cam, RSI chưa có đường MA, Stochastic smooth 3
    expect(migrateInstance({ v: 1, uid: "a", id: "sma", inputs: {} })?.inputs).toEqual({ length: 20 });
    const ema = migrateInstance({ v: 1, uid: "b", id: "ema" });
    expect(ema?.inputs).toEqual({ length: 20 });
    expect(ema?.style?.plots?.ema?.color).toBe("#ff9800");
    expect(migrateInstance({ uid: "c", id: "rsi" })?.inputs).toEqual({ smoothType: "None" });
    expect(migrateInstance({ v: 1, uid: "d", id: "stoch" })?.inputs).toEqual({ smooth: 3 });
    // phần user đã đặt thắng mặc định cũ
    const own = migrateInstance({ v: 1, uid: "e", id: "ema", inputs: { length: 50 }, style: { plots: { ema: { color: "#123456" } } } });
    expect(own?.inputs).toEqual({ length: 50 });
    expect(own?.style?.plots?.ema?.color).toBe("#123456");
    // đã là v2 (kể cả instance mới) thì không điền gì và theo mặc định TV
    expect(migrateInstance({ v: 2, uid: "f", id: "ema" })?.inputs).toEqual({});
    expect(resolveInputs(byId("ema"), newInstance("ema").inputs).length).toBe(9);
    expect(plotColor(newInstance("ema"), byId("ema"), "ema")).toBe("#2962ff");
    // Pivots cũ: R đỏ, S xanh
    const piv = migrateInstance({ v: 1, uid: "g", id: "pivots" });
    expect(piv?.style?.items?.R1?.color).toBe("#f23645");
    expect(piv?.style?.items?.S3?.color).toBe("#089981");
    expect(piv?.style?.items?.P).toBeUndefined();
  });

  it("dạng mới đi vòng lưu/đọc không mất gì", () => {
    const a = withPlotColor({ ...newInstance("macd"), uid: "u2", inputs: { fast: 8 } }, "signal", "#abcdef");
    expect(migrateInstance(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });

  it("bỏ input lạ / sai kiểu, giữ phần còn lại", () => {
    const m = migrateInstance({ v: 2, uid: "u3", id: "sma", inputs: { length: "x", src: "hl2", junk: 1 } });
    expect(m?.inputs).toEqual({ src: "hl2" });
  });

  it("id lạ, volume (store riêng) và rác -> null", () => {
    expect(migrateInstance({ uid: "u", id: "zigzag", inputs: {} })).toBeNull();
    expect(migrateInstance({ uid: "u", id: "volume", inputs: {} })).toBeNull();
    expect(migrateInstance(null)).toBeNull();
    expect(migrateInstance("sma")).toBeNull();
    expect(migrateInstance({ inputs: {} })).toBeNull();
  });

  it("thiếu uid -> sinh mới; trùng uid -> sinh lại; không phải mảng -> []", () => {
    const [a, b, c] = migrateInstances([{ id: "sma" }, { uid: "dup", id: "ema" }, { uid: "dup", id: "wma" }]);
    expect(a.uid).toBeTruthy();
    expect(b.uid).toBe("dup");
    expect(c.uid).not.toBe("dup");
    expect(migrateInstances("x")).toEqual([]);
    expect(migrateInstances([{ id: "nope" }, { id: "rsi", uid: "r" }]).map((i) => i.id)).toEqual(["rsi"]);
  });

  it("màu rỗng / không phải chuỗi bị bỏ", () => {
    const m = migrateInstance({ uid: "u", id: "sma", inputs: {}, colors: [""] });
    expect(m?.style).toBeUndefined();
    expect(migrateInstance({ uid: "u", id: "sma", colors: [5] })?.style).toBeUndefined();
  });
});

describe("plotColor / withPlotColor / inputsText", () => {
  const def = byId("rsi");
  const inst = newInstance("rsi");

  it("mặc định theo def, đổi không sửa bản gốc", () => {
    expect(plotColor(inst, def, "rsi")).toBe("#7e57c2");
    const b = withPlotColor(inst, "rsi", "#ffffff");
    expect(plotColor(b, def, "rsi")).toBe("#ffffff");
    expect(inst.style).toBeUndefined();
  });

  it("legend: giá trị đã điền mặc định, bool không hiện", () => {
    expect(inputsText(def, inst)).toBe("14 close SMA 14 2"); // RSI bật SMA 14 mặc định như TV
    expect(inputsText(byId("sma"), newInstance("sma"))).toBe("9 close 0 None 14 2");
    expect(inputsText(byId("vwap"), { ...newInstance("vwap"), inputs: { anchor: "Week" } })).toBe("Week hlc3 0"); // Session start và các ô của band không in lên legend
    expect(inputsText(byId("cvd"), newInstance("cvd"))).toBe("1D");
  });
});

describe("trạng thái hiển thị của instance", () => {
  it("đi vòng lưu/đọc: hidden, visibility, precision, status, plot ẩn", () => {
    const a = {
      ...newInstance("macd"),
      uid: "m",
      hidden: true,
      visibility: { minutes: { on: true, from: 5, to: 30 }, hours: { on: false, from: 1, to: 24 } },
      precision: 3,
      priceLabel: false,
      statusValues: false as const,
      statusInputs: false as const,
      style: { plots: { signal: { visible: false as const }, macd: { color: "#123456" } } },
    };
    expect(migrateInstance(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });

  it("giá trị rác bị bỏ, khoảng visibility được chặn về giới hạn của đơn vị", () => {
    const m = migrateInstance({
      v: 2, uid: "u", id: "rsi", hidden: "yes", precision: 99, priceLabel: 1, statusValues: true,
      visibility: { minutes: { on: true, from: -4, to: 500 }, bogus: { on: true, from: 1, to: 2 }, hours: { on: "x", from: 1, to: 2 } },
    });
    expect(m).toEqual({ v: 2, uid: "u", id: "rsi", inputs: {}, visibility: { minutes: { on: true, from: 1, to: 59 } } });
  });

  it("instanceShown: mắt và khung thời gian", () => {
    const inst = newInstance("sma");
    expect(instanceShown(inst, "M15")).toBe(true);
    expect(instanceShown({ ...inst, hidden: true }, "M15")).toBe(false);
    const onlyH1 = { ...inst, visibility: { minutes: { on: false, from: 1, to: 59 } } };
    expect(instanceShown(onlyH1, "M15")).toBe(false);
    expect(instanceShown(onlyH1, "H1")).toBe(true);
  });

  it("plotShown / showsPriceLabel: mặc định hiện; nhãn giá theo overlay", () => {
    const inst = newInstance("sma");
    expect(plotShown(inst, "sma")).toBe(true);
    expect(plotShown({ ...inst, style: { plots: { sma: { visible: false } } } }, "sma")).toBe(false);
    expect(showsPriceLabel(inst, byId("sma"))).toBe(false);
    expect(showsPriceLabel(newInstance("rsi"), byId("rsi"))).toBe(true);
    expect(showsPriceLabel({ ...inst, priceLabel: true }, byId("sma"))).toBe(true);
  });
});

describe("style đã lưu (nét, độ dày, kiểu, levels, fills)", () => {
  it("đi vòng lưu/đọc", () => {
    const a = {
      ...newInstance("rsi"),
      uid: "r",
      style: {
        plots: { rsi: { color: "#112233", width: 3, lineStyle: "dotted" as const, type: "step" as const } },
        levels: { upper: { value: 80, color: "#ff0000", visible: false as const, width: 2, lineStyle: "solid" as const } },
        fills: { band: { color: "#00ff0033", visible: false as const } },
      },
    };
    expect(migrateInstance(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });

  it("giá trị lạ bị bỏ; plot perBar không đổi được kiểu; level/fill không còn trong def bị bỏ", () => {
    const m = migrateInstance({
      uid: "m", id: "macd",
      style: { plots: { hist: { type: "line", width: 9 }, macd: { type: "bogus", lineStyle: "wavy", width: 2 } }, levels: { nope: { value: 1 } }, fills: { x: { color: "#fff" } } },
    });
    expect(m?.style).toEqual({ plots: { macd: { width: 2 } } });
    const r = migrateInstance({ uid: "r", id: "rsi", style: { levels: { upper: { value: "x", color: "red" }, nope: { value: 1 } } } });
    expect(r?.style).toBeUndefined();
  });
});

describe("màu nến giảm của plot candles", () => {
  it("chỉ plot candles giữ colorDown", () => {
    const m = migrateInstance({ uid: "u", id: "rsi", style: { plots: { rsi: { colorDown: "#ff0000", color: "#111111" } } } });
    expect(m?.style).toEqual({ plots: { rsi: { color: "#111111" } } });
  });
});

describe("màu fill thứ hai (mây Ichimoku)", () => {
  it("chỉ fill có colorDown giữ colorDown đã lưu", () => {
    const k = migrateInstance({ v: 2, uid: "u", id: "ichimoku", style: { fills: { cloud: { colorDown: "#ff0000", color: "#00ff00" } } } });
    expect(k?.style).toEqual({ fills: { cloud: { color: "#00ff00", colorDown: "#ff0000" } } });
    const r = migrateInstance({ uid: "u", id: "rsi", style: { fills: { band: { colorDown: "#ff0000", color: "#00ff00" } } } });
    expect(r?.style).toEqual({ fills: { band: { color: "#00ff00" } } });
  });
});

describe("style của items (mức pivot, profile...)", () => {
  it("giữ phần hợp lệ của item mà def còn có, bỏ item lạ và giá trị sai", () => {
    const m = migrateInstance({
      v: 2, uid: "u", id: "pivots",
      style: { items: { R1: { color: "#ff0000", visible: false, width: 3, lineStyle: "dashed" }, S2: { width: 9, lineStyle: "wavy", color: "red" }, ZZ: { color: "#00ff00" } } },
    });
    expect(m?.style).toEqual({ items: { R1: { color: "#ff0000", visible: false, width: 3, lineStyle: "dashed" } } });
  });
});
