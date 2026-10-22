import { describe, expect, it } from "vitest";
import { byId } from "./catalog";
import { coerceInput, inputsText, migrateInstance, migrateInstances, newInstance, plotColor, resolveInputs, withPlotColor } from "./instance";

describe("resolveInputs", () => {
  const sma = byId("sma");

  it("thiếu / sai kiểu -> mặc định; số nguyên được làm tròn và chặn min", () => {
    expect(resolveInputs(sma, undefined)).toEqual({ length: 20, src: "close" });
    expect(resolveInputs(sma, { length: "9", src: "nope" })).toEqual({ length: 20, src: "close" });
    expect(resolveInputs(sma, { length: 9.6, src: "hl2" })).toEqual({ length: 10, src: "hl2" });
    expect(resolveInputs(sma, { length: -5 })).toEqual({ length: 1, src: "close" });
  });

  it("bool và select", () => {
    const vwap = byId("vwap");
    expect(resolveInputs(vwap, { anchor: "Week" })).toEqual({ anchor: "Week", src: "hlc3" });
    expect(resolveInputs(vwap, { anchor: "Decade" })).toEqual({ anchor: "Session", src: "hlc3" });
    expect(coerceInput({ key: "k", label: "k", type: "bool", default: false }, true)).toBe(true);
    expect(coerceInput({ key: "k", label: "k", type: "bool", default: false }, 1)).toBeUndefined();
    expect(coerceInput({ key: "k", label: "k", type: "float", default: 1 }, NaN)).toBeUndefined();
  });
});

describe("migrateInstance", () => {
  it("dạng cũ {uid,id,inputs,colors[]}: colors[k] -> màu plot thứ k", () => {
    const m = migrateInstance({ uid: "u1", id: "bb", inputs: { length: 10, mult: 2.5, src: "close" }, colors: ["#111111", "#222222", "#333333"] });
    expect(m).toEqual({
      v: 1,
      uid: "u1",
      id: "bb",
      inputs: { length: 10, mult: 2.5, src: "close" },
      style: { plots: { basis: { color: "#111111" }, upper: { color: "#222222" }, lower: { color: "#333333" } } },
    });
  });

  it("dạng mới đi vòng lưu/đọc không mất gì", () => {
    const a = withPlotColor({ ...newInstance("macd"), uid: "u2", inputs: { fast: 8 } }, "signal", "#abcdef");
    expect(migrateInstance(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });

  it("bỏ input lạ / sai kiểu, giữ phần còn lại", () => {
    const m = migrateInstance({ uid: "u3", id: "sma", inputs: { length: "x", src: "hl2", junk: 1 } });
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
    expect(inputsText(def, inst)).toBe("14 close");
    expect(inputsText(byId("vwap"), { ...newInstance("vwap"), inputs: { anchor: "Week" } })).toBe("Week hlc3");
  });
});
