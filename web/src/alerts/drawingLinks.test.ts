import { describe, expect, it } from "vitest";
import type { Drawing } from "@/drawings/types";
import type { Alert, AlertDrawing } from "@/lib/alertsApi";
import { planLinks } from "./drawingLinks";
import { specFromDrawing } from "./drawingSpec";

const draw = (id: string, price2 = 2): Drawing => ({ id, type: "trendline", points: [{ time: 100, price: 1 }, { time: 200, price: price2 }], color: "#fff", width: 1, locked: false, hidden: false, opts: { extend: "right" } });
const link = (d: Drawing, over: Partial<AlertDrawing> = {}): AlertDrawing => ({ ...specFromDrawing(d, { layout: "L", log: false })!, ...over });
const alert = (id: string, drawing: AlertDrawing | null, over: Partial<Alert> = {}): Alert => ({
  id, symbol: "XAUUSDm", cond: "cross", level: 1, trigger: "once", tf: "M5", expires_at: null, name: "", message: "", channels: { web: true, telegram: false, mt5: false },
  state: "active", created_at: 1, fired_at: null, fire_count: 0, drawing, ...over,
});
const doc = (drawings: Drawing[], over = {}) => ({ symbol: "XAUUSDm", layoutId: "L", drawings, ...over });

describe("planLinks", () => {
  it("does nothing while the drawing still matches its alert", () => {
    const d = draw("a");
    expect(planLinks([alert("x", link(d))], doc([d]))).toEqual({ patch: [], gone: [] });
  });

  it("sends the new coordinates when the drawing was moved or its extension changed", () => {
    const d = draw("a");
    const moved = draw("a", 3);
    const plan = planLinks([alert("x", link(d))], doc([moved]));
    expect(plan.gone).toEqual([]);
    expect(plan.patch).toHaveLength(1);
    expect(plan.patch[0].spec.pts).toEqual([[100, 1], [200, 3]]);
    expect(plan.patch[0].spec.log).toBe(false); // giữ thang giá lúc tạo, không theo chart đang sửa
    const ext = { ...d, opts: { extend: "none" } };
    expect(planLinks([alert("x", link(d))], doc([ext])).patch).toHaveLength(1);
  });

  it("styling changes do not touch the alert", () => {
    const d = draw("a");
    expect(planLinks([alert("x", link(d))], doc([{ ...d, color: "#f00", width: 4, text: "hi" }]))).toEqual({ patch: [], gone: [] });
  });

  it("reports the alert of a deleted drawing", () => {
    const d = draw("a");
    expect(planLinks([alert("x", link(d))], doc([draw("b")])).gone.map((a) => a.id)).toEqual(["x"]);
  });

  it("ignores alerts of other symbols and other layouts (their drawings are simply not in this doc)", () => {
    const d = draw("a");
    expect(planLinks([alert("x", link(d), { symbol: "BTCUSDm" })], doc([]))).toEqual({ patch: [], gone: [] });
    expect(planLinks([alert("x", link(d, { layout: "OTHER" }))], doc([]))).toEqual({ patch: [], gone: [] });
  });

  it("ignores finished, unlinked and price-level alerts", () => {
    const d = draw("a");
    expect(planLinks([alert("x", link(d), { state: "triggered" }), alert("y", link(d, { id: null })), alert("z", null)], doc([]))).toEqual({ patch: [], gone: [] });
    expect(planLinks([alert("p", link(d), { state: "paused" })], doc([])).gone).toHaveLength(1); // tạm dừng vẫn bám hình
  });
});
