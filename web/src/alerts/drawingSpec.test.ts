import { describe, expect, it } from "vitest";
import type { Drawing } from "@/drawings/types";
import type { AlertDrawing } from "@/lib/alertsApi";
import type { Bar } from "@/lib/api";
import { BAND_CONDS, LINE_CONDS, condsFor, defaultCondFor, geometryAt, geometrySig, levelNow, specFromDrawing, spanText, supportsAlert } from "./drawingSpec";

const spec = (type: string, pts: [number, number][], ext: AlertDrawing["ext"] = "right", log = false): AlertDrawing => ({ id: "d1", layout: "L", type, label: type, pts, ext, log });
const draw = (type: string, points: { time: number; price: number }[], opts?: Drawing["opts"]): Drawing => ({ id: "x1", type, points, color: "#fff", width: 1, locked: false, hidden: false, opts });
const bars = (times: number[]): Bar[] => times.map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 }));

describe("geometryAt (same numbers as backend/tests/test_drawing_alerts.py)", () => {
  it("line follows the candle index, segment ends, extended lines do not", () => {
    const line = spec("trendline", [[0, 100], [600, 110]]);
    expect(geometryAt(line, [0, 10], 5)).toEqual({ state: "ok", lo: 105, hi: 105 });
    expect(geometryAt(line, [0, 10], 20)).toEqual({ state: "ok", lo: 120, hi: 120 });
    expect(geometryAt(spec("trendline", [[600, 110], [0, 100]]), [10, 0], 5).lo).toBe(105); // điểm neo nhập ngược
    const seg = spec("trendline", [[0, 100], [600, 110]], "none");
    expect(geometryAt(seg, [0, 10], 10).state).toBe("ok");
    expect(geometryAt(seg, [0, 10], 10.5).state).toBe("done");
    expect(geometryAt(seg, [5, 10], 2).state).toBe("wait");
    expect(geometryAt(spec("trendline", [[0, 100], [600, 110]], "left"), [5, 10], 2)).toEqual({ state: "ok", lo: 94, hi: 94 });
  });

  it("horizontal line and ray", () => {
    expect(geometryAt(spec("hline", [[0, 50]], "none"), [3], -100)).toEqual({ state: "ok", lo: 50, hi: 50 });
    const ray = spec("hray", [[0, 50]], "right");
    expect(geometryAt(ray, [3], 1).state).toBe("wait");
    expect(geometryAt(ray, [3], 999).state).toBe("ok");
  });

  it("log scale is straight in ln(price); non-positive prices fall back to linear", () => {
    expect(geometryAt(spec("trendline", [[0, 100], [600, 400]], "right", true), [0, 10], 5).lo).toBeCloseTo(200, 9);
    expect(geometryAt(spec("trendline", [[0, 100], [600, 400]], "right", false), [0, 10], 5).lo).toBeCloseTo(250, 9);
    expect(geometryAt(spec("trendline", [[0, -5], [600, 5]], "right", true), [0, 10], 5).lo).toBeCloseTo(0, 9);
  });

  it("channel is two parallel lines through the third point", () => {
    const ch = spec("channel", [[0, 100], [600, 110], [300, 112]]);
    expect(geometryAt(ch, [0, 10, 5], 5)).toEqual({ state: "ok", lo: 105, hi: 112 });
    expect(geometryAt(ch, [0, 10, 5], 10)).toEqual({ state: "ok", lo: 110, hi: 117 });
    expect(geometryAt(spec("channel", [[0, 100], [600, 110], [300, 100]]), [0, 10, 5], 5)).toEqual({ state: "ok", lo: 100, hi: 105 });
  });

  it("rectangle is a fixed band inside its time span", () => {
    const r = spec("rect", [[0, 110], [600, 100]], "none");
    expect(geometryAt(r, [0, 10], 5)).toEqual({ state: "ok", lo: 100, hi: 110 });
    expect(geometryAt(r, [0, 10], 11).state).toBe("done");
    expect(geometryAt(spec("rect", [[0, 110], [600, 100]], "right"), [0, 10], 50).state).toBe("ok");
  });
});

describe("levelNow", () => {
  it("counts candles, not clock time: a weekend gap does not flatten the line", () => {
    const t0 = 1_800_000_000;
    // 10 nến liên tục, nghỉ 1000 phút, rồi 10 nến nữa (nến cuối là nến đang chạy): đường 100 -> 115 qua 15 nến
    const times = [...Array.from({ length: 10 }, (_, i) => t0 + i * 60), ...Array.from({ length: 10 }, (_, i) => t0 + 1000 * 60 + i * 60)];
    const line = spec("trendline", [[times[0], 100], [times[15], 115]]);
    const g = levelNow(line, bars(times), 60)!;
    expect(g.state).toBe("ok");
    expect(g.lo).toBeCloseTo(119, 9); // nến cuối = chỉ số 19: 100 + 19
  });

  it("is null without candles", () => {
    expect(levelNow(spec("hline", [[0, 5]], "none"), [], 60)).toBeNull();
  });
});

describe("specFromDrawing", () => {
  it("copies anchors and the extend option, keeps only the points the shape needs", () => {
    const d = draw("trendline", [{ time: 100.4, price: 1 }, { time: 200, price: 2 }], { extend: "both" });
    expect(specFromDrawing(d, { layout: "L", log: true })).toEqual({ id: "x1", layout: "L", type: "trendline", label: "Trendline", pts: [[100, 1], [200, 2]], ext: "both", log: true });
    const ray = specFromDrawing(draw("ray", [{ time: 1, price: 1 }, { time: 2, price: 2 }]), { layout: "L", log: false })!;
    expect(ray.ext).toBe("right"); // mặc định của công cụ Ray
    expect(specFromDrawing(draw("hline", [{ time: 5, price: 9 }]), { layout: "L", log: false })!).toMatchObject({ pts: [[5, 9]], ext: "none" });
  });

  it("returns null for tools without an alert and for incomplete shapes", () => {
    expect(supportsAlert("fib")).toBe(false);
    expect(specFromDrawing(draw("fib", [{ time: 1, price: 1 }, { time: 2, price: 2 }]), { layout: "L", log: false })).toBeNull();
    expect(specFromDrawing(draw("channel", [{ time: 1, price: 1 }, { time: 2, price: 2 }]), { layout: "L", log: false })).toBeNull();
  });
});

describe("geometrySig and conditions", () => {
  it("changes with the anchors or extension, not with the label or the link", () => {
    const a = spec("trendline", [[0, 1], [10, 2]]);
    expect(geometrySig(a)).toBe(geometrySig({ ...a, label: "other", id: null, layout: "Z", log: true }));
    expect(geometrySig(a)).not.toBe(geometrySig({ ...a, pts: [[0, 1], [10, 2.5]] }));
    expect(geometrySig(a)).not.toBe(geometrySig({ ...a, ext: "none" }));
  });

  it("offers entering / exiting only for bands", () => {
    expect(condsFor(null)).toEqual(LINE_CONDS);
    expect(condsFor({ type: "trendline" })).toEqual(LINE_CONDS);
    expect(condsFor({ type: "rect" })).toEqual(BAND_CONDS);
    expect(condsFor({ type: "channel" })).toEqual(BAND_CONDS);
    expect(defaultCondFor({ type: "rect" })).toBe("enter");
    expect(defaultCondFor({ type: "ray" })).toBe("cross");
  });

  it("formats a level or a band", () => {
    expect(spanText(5, 5, String)).toBe("5");
    expect(spanText(5, 6, String)).toBe("5–6");
  });
});
