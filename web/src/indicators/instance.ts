import { UNITS, visibleOn, type Visibility } from "@/drawings/visibility";
import { findDef } from "./catalog";
import type { IndicatorDef, InputDef, InputValue, Inputs, LineStyleName, PlotType } from "./schema";
import { SOURCES } from "./ta";

export const INSTANCE_V = 2;

// Instance lưu chỉ phần user đã đặt, còn lại theo mặc định của def. Khi mặc định đổi theo TV (2026-10-25: SMA/EMA/WMA length 9, màu BB / EMA / WMA...),
// instance cũ (v < 2) phải giữ nguyên bộ cũ: điền lại vào chỗ user chưa đặt rồi lưu thành v2.
type Legacy = { inputs?: Inputs; plots?: Record<string, string>; fills?: Record<string, string>; items?: Record<string, string> };
const LEGACY_V1: Record<string, Legacy> = {
  sma: { inputs: { length: 20 } },
  ema: { inputs: { length: 20 }, plots: { ema: "#ff9800" } },
  wma: { inputs: { length: 20 }, plots: { wma: "#e91e63" } },
  rsi: { inputs: { smoothType: "None" } },
  cci: { inputs: { smoothType: "None" } },
  stoch: { inputs: { smooth: 3 } },
  bb: { plots: { basis: "#ff6d00", upper: "#2962ff", lower: "#2962ff" }, fills: { band: "#2196f31a" } },
  supertrend: { plots: { down: "#ff5252" }, fills: { downFill: "#ff52521a" } },
  adx: { plots: { adx: "#f50057" } },
  dmi: { plots: { adx: "#f23645" } },
  ichimoku: { plots: { leadB: "#faa1a4" } },
  vwap: { plots: { upper3: "#00897b", lower3: "#00897b" }, fills: { fill3: "#00897b0d" } },
  pivots: { items: Object.fromEntries(["R1", "R2", "R3", "R4", "R5"].map((k) => [k, "#f23645"]).concat(["S1", "S2", "S3", "S4", "S5"].map((k) => [k, "#089981"]))) },
};

/** Điền mặc định cũ vào instance v1 (chỗ user chưa đặt). */
function applyLegacy(def: IndicatorDef, inputs: Inputs, style: IndicatorInstance["style"]): { inputs: Inputs; style: IndicatorInstance["style"] } {
  const lg = LEGACY_V1[def.id];
  if (!lg) return { inputs, style };
  const out = { ...inputs };
  for (const [k, v] of Object.entries(lg.inputs ?? {})) if (out[k] === undefined && def.inputs.some((i) => i.key === k)) out[k] = v;
  const next: NonNullable<IndicatorInstance["style"]> = { ...style };
  const fill = <T extends { color?: string }>(cur: Record<string, T> | undefined, legacy: Record<string, string> | undefined, ids: string[] | undefined) => {
    if (!legacy) return cur;
    const res = { ...cur } as Record<string, T>;
    for (const [id, color] of Object.entries(legacy)) if (ids?.includes(id) && !res[id]?.color) res[id] = { ...res[id], color } as T;
    return res;
  };
  const plots = fill(style?.plots, lg.plots, def.plots.map((p) => p.id));
  const fills = fill(style?.fills, lg.fills, def.fills?.map((f) => f.id));
  const items = fill(style?.items, lg.items, def.items?.map((i) => i.id));
  if (plots) next.plots = plots;
  if (fills) next.fills = fills;
  if (items) next.items = items;
  return { inputs: out, style: Object.keys(next).length ? next : undefined };
}

export type PlotStyle = { color?: string; colorDown?: string; visible?: boolean; width?: number; lineStyle?: LineStyleName; type?: PlotType };
export type LevelStyle = { value?: number; color?: string; visible?: boolean; width?: number; lineStyle?: LineStyleName };
export type FillStyle = { color?: string; colorDown?: string; visible?: boolean };
export type ItemStyleU = { color?: string; visible?: boolean; width?: number; lineStyle?: LineStyleName };

/** Một indicator đang dùng trên chart (lưu trong layout). Mọi field ngoài định danh chỉ chứa phần user đã đặt; còn lại theo def. */
export type IndicatorInstance = {
  v: number;
  uid: string;
  id: string;
  inputs: Inputs;
  style?: { plots?: Record<string, PlotStyle>; levels?: Record<string, LevelStyle>; fills?: Record<string, FillStyle>; items?: Record<string, ItemStyleU> };
  pane?: string; // khoá pane (xem layout.ts); không đặt = mặc định theo def
  scale?: "right" | "left" | "none"; // thang giá; không đặt = mặc định (xem effectiveScale)
  hidden?: boolean; // nút mắt
  visibility?: Visibility; // hiện theo khung thời gian
  precision?: number; // số chữ số của giá trị (không đặt = mặc định)
  priceLabel?: boolean; // nhãn giá cuối trên trục (không đặt = theo def: chỉ indicator ở pane riêng)
  statusValues?: boolean; // giá trị trên legend (mặc định bật)
  statusInputs?: boolean; // tham số trên legend (mặc định bật)
};

/** Indicator có đang được vẽ không (không bị ẩn bằng nút mắt, đúng khung thời gian). */
export const instanceShown = (inst: IndicatorInstance, tf: string): boolean => !inst.hidden && visibleOn(inst.visibility, tf);

export const plotShown = (inst: IndicatorInstance, plotId: string): boolean => inst.style?.plots?.[plotId]?.visible !== false;

export const showsPriceLabel = (inst: IndicatorInstance, def: IndicatorDef): boolean => inst.priceLabel ?? !def.overlay;

/** Giá trị hợp lệ theo kiểu input (ép số nguyên, chặn min/max), hoặc undefined nếu không dùng được. */
export function coerceInput(def: InputDef, v: unknown): InputValue | undefined {
  switch (def.type) {
    case "int":
    case "float": {
      if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
      const x = def.type === "int" ? Math.round(v) : v;
      return Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, x));
    }
    case "bool":
      return typeof v === "boolean" ? v : undefined;
    case "select":
      return typeof v === "string" && def.options.includes(v) ? v : undefined;
    case "source":
      return typeof v === "string" && (SOURCES as readonly string[]).includes(v) ? v : undefined;
  }
}

/** Inputs đầy đủ để tính/hiển thị: giá trị đã lưu nếu hợp lệ, không thì mặc định. */
export function resolveInputs(def: IndicatorDef, given: Inputs | undefined): Inputs {
  return Object.fromEntries(def.inputs.map((i) => [i.key, coerceInput(i, given?.[i.key]) ?? i.default]));
}

export function newInstance(defId: string): IndicatorInstance {
  return { v: INSTANCE_V, uid: crypto.randomUUID(), id: defId, inputs: {} };
}

export function plotColor(inst: IndicatorInstance, def: IndicatorDef, plotId: string): string {
  return inst.style?.plots?.[plotId]?.color ?? def.plots.find((p) => p.id === plotId)?.color ?? "#888888";
}

export function withPlotColor(inst: IndicatorInstance, plotId: string, color: string): IndicatorInstance {
  const plots = inst.style?.plots ?? {};
  return { ...inst, style: { ...inst.style, plots: { ...plots, [plotId]: { ...plots[plotId], color } } } };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Đọc 1 instance đã lưu, kể cả dạng cũ `{uid,id,inputs,colors[]}` (colors[k] = màu plot thứ k). null nếu không dùng được. */
export function migrateInstance(raw: unknown): IndicatorInstance | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const def = findDef(raw.id);
  if (!def || def.id === "volume") return null; // Volume có store riêng; id lạ (bản app khác) bỏ qua để chart không vỡ

  const inputs: Inputs = {};
  if (isRecord(raw.inputs))
    for (const i of def.inputs) {
      const v = coerceInput(i, raw.inputs[i.key]);
      if (v !== undefined) inputs[i.key] = v;
    }

  let style = sanitizeStyle(raw, def);
  if (typeof raw.v !== "number" || raw.v < 2) {
    const legacy = applyLegacy(def, inputs, style);
    Object.assign(inputs, legacy.inputs);
    style = legacy.style;
  }

  return {
    v: INSTANCE_V,
    uid: typeof raw.uid === "string" && raw.uid ? raw.uid : crypto.randomUUID(),
    id: def.id,
    inputs,
    ...(style ? { style } : {}),
    ...(typeof raw.pane === "string" && raw.pane && raw.pane.length <= 80 ? { pane: raw.pane } : {}),
    ...(raw.scale === "right" || raw.scale === "left" || raw.scale === "none" ? { scale: raw.scale } : {}),
    ...(raw.hidden === true ? { hidden: true } : {}),
    ...(sanitizeVisibility(raw.visibility) ? { visibility: sanitizeVisibility(raw.visibility) } : {}),
    ...(typeof raw.precision === "number" && Number.isInteger(raw.precision) && raw.precision >= 0 && raw.precision <= 8 ? { precision: raw.precision } : {}),
    ...(typeof raw.priceLabel === "boolean" ? { priceLabel: raw.priceLabel } : {}),
    ...(raw.statusValues === false ? { statusValues: false } : {}),
    ...(raw.statusInputs === false ? { statusInputs: false } : {}),
  };
}

const LINE_STYLE_IDS: readonly string[] = ["solid", "dashed", "dotted"];
const PLOT_TYPE_IDS: readonly string[] = ["line", "step", "histogram", "area", "circles", "cross", "linebr"];
const colorOf = (v: unknown): string | undefined =>
  typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6}([0-9a-f]{2})?)$/i.test(v.trim()) ? v.trim() : undefined;
const widthOf = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 4 ? v : undefined);
const lineStyleOf = (v: unknown): LineStyleName | undefined => (typeof v === "string" && LINE_STYLE_IDS.includes(v) ? (v as LineStyleName) : undefined);

/** Style đã lưu -> chỉ phần hợp lệ của plot/level/fill mà def còn có (dạng cũ: `colors[k]` = màu plot thứ k). */
function sanitizeStyle(raw: Record<string, unknown>, def: IndicatorDef): IndicatorInstance["style"] {
  const src = isRecord(raw.style) ? raw.style : {};
  const sub = (k: string) => (isRecord(src[k]) ? (src[k] as Record<string, unknown>) : {});
  const plots: Record<string, PlotStyle> = {};
  def.plots.forEach((p, k) => {
    const s = isRecord(sub("plots")[p.id]) ? (sub("plots")[p.id] as Record<string, unknown>) : null;
    const ps: PlotStyle = {};
    const color = colorOf(s ? s.color : Array.isArray(raw.colors) ? raw.colors[k] : undefined);
    if (color) ps.color = color;
    if (p.type === "candles" && colorOf(s?.colorDown)) ps.colorDown = colorOf(s?.colorDown);
    if (s?.visible === false) ps.visible = false;
    if (widthOf(s?.width)) ps.width = widthOf(s?.width);
    if (lineStyleOf(s?.lineStyle)) ps.lineStyle = lineStyleOf(s?.lineStyle);
    if (!p.perBar && p.type !== "candles" && typeof s?.type === "string" && PLOT_TYPE_IDS.includes(s.type)) ps.type = s.type as PlotType;
    if (Object.keys(ps).length) plots[p.id] = ps;
  });
  const levels: Record<string, LevelStyle> = {};
  for (const l of def.levels ?? []) {
    const s = isRecord(sub("levels")[l.id]) ? (sub("levels")[l.id] as Record<string, unknown>) : null;
    if (!s) continue;
    const ls: LevelStyle = {};
    if (typeof s.value === "number" && Number.isFinite(s.value)) ls.value = s.value;
    if (colorOf(s.color)) ls.color = colorOf(s.color);
    if (s.visible === false) ls.visible = false;
    if (widthOf(s.width)) ls.width = widthOf(s.width);
    if (lineStyleOf(s.lineStyle)) ls.lineStyle = lineStyleOf(s.lineStyle);
    if (Object.keys(ls).length) levels[l.id] = ls;
  }
  const fills: Record<string, FillStyle> = {};
  for (const f of def.fills ?? []) {
    const s = isRecord(sub("fills")[f.id]) ? (sub("fills")[f.id] as Record<string, unknown>) : null;
    if (!s) continue;
    const fs: FillStyle = {};
    if (colorOf(s.color)) fs.color = colorOf(s.color);
    if (f.colorDown && colorOf(s.colorDown)) fs.colorDown = colorOf(s.colorDown);
    if (s.visible === false) fs.visible = false;
    if (Object.keys(fs).length) fills[f.id] = fs;
  }
  const items: Record<string, ItemStyleU> = {};
  for (const it of def.items ?? []) {
    const s = isRecord(sub("items")[it.id]) ? (sub("items")[it.id] as Record<string, unknown>) : null;
    if (!s) continue;
    const is: ItemStyleU = {};
    if (colorOf(s.color)) is.color = colorOf(s.color);
    if (s.visible === false) is.visible = false;
    if (it.line && widthOf(s.width)) is.width = widthOf(s.width);
    if (it.line && lineStyleOf(s.lineStyle)) is.lineStyle = lineStyleOf(s.lineStyle);
    if (Object.keys(is).length) items[it.id] = is;
  }
  const out: NonNullable<IndicatorInstance["style"]> = {};
  if (Object.keys(items).length) out.items = items;
  if (Object.keys(plots).length) out.plots = plots;
  if (Object.keys(levels).length) out.levels = levels;
  if (Object.keys(fills).length) out.fills = fills;
  return Object.keys(out).length ? out : undefined;
}

/** Chỉ nhận đơn vị đã biết với {on, from, to} hợp lệ; rỗng -> undefined (= hiện ở mọi khung). */
function sanitizeVisibility(raw: unknown): Visibility | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Visibility = {};
  for (const { id, max } of UNITS) {
    const r = raw[id];
    if (!isRecord(r) || typeof r.on !== "boolean" || typeof r.from !== "number" || typeof r.to !== "number") continue;
    if (!Number.isFinite(r.from) || !Number.isFinite(r.to)) continue;
    const from = Math.max(1, Math.min(max, Math.round(r.from)));
    out[id] = { on: r.on, from, to: Math.max(from, Math.min(max, Math.round(r.to))) };
  }
  return Object.keys(out).length ? out : undefined;
}

export function migrateInstances(raw: unknown): IndicatorInstance[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: IndicatorInstance[] = [];
  for (const r of raw) {
    const inst = migrateInstance(r);
    if (!inst) continue;
    if (seen.has(inst.uid)) inst.uid = crypto.randomUUID();
    seen.add(inst.uid);
    out.push(inst);
  }
  return out;
}

/** Tham số hiện trên legend: "20 close". Bool không hiện (như TV). */
export function inputsText(def: IndicatorDef, inst: IndicatorInstance): string {
  const r = resolveInputs(def, inst.inputs);
  return def.inputs.filter((i) => i.type !== "bool" && !i.hideInLegend).map((i) => r[i.key]).join(" ");
}
