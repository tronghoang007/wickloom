import { UNITS, visibleOn, type Visibility } from "@/drawings/visibility";
import { findDef } from "./catalog";
import type { IndicatorDef, InputDef, InputValue, Inputs } from "./schema";
import { SOURCES } from "./ta";

export const INSTANCE_V = 1;

export type PlotStyle = { color?: string; visible?: boolean };

/** Một indicator đang dùng trên chart (lưu trong layout). Mọi field ngoài định danh chỉ chứa phần user đã đặt; còn lại theo def. */
export type IndicatorInstance = {
  v: number;
  uid: string;
  id: string;
  inputs: Inputs;
  style?: { plots?: Record<string, PlotStyle> };
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

  const plots: Record<string, PlotStyle> = {};
  const style = isRecord(raw.style) && isRecord(raw.style.plots) ? raw.style.plots : null;
  def.plots.forEach((p, k) => {
    const saved = style && isRecord(style[p.id]) ? (style[p.id] as Record<string, unknown>) : null;
    const color = saved ? saved.color : Array.isArray(raw.colors) ? raw.colors[k] : undefined; // dạng cũ: colors[k]
    const ps: PlotStyle = {};
    if (typeof color === "string" && color) ps.color = color;
    if (saved?.visible === false) ps.visible = false;
    if (Object.keys(ps).length) plots[p.id] = ps;
  });

  return {
    v: INSTANCE_V,
    uid: typeof raw.uid === "string" && raw.uid ? raw.uid : crypto.randomUUID(),
    id: def.id,
    inputs,
    ...(Object.keys(plots).length ? { style: { plots } } : {}),
    ...(raw.hidden === true ? { hidden: true } : {}),
    ...(sanitizeVisibility(raw.visibility) ? { visibility: sanitizeVisibility(raw.visibility) } : {}),
    ...(typeof raw.precision === "number" && Number.isInteger(raw.precision) && raw.precision >= 0 && raw.precision <= 8 ? { precision: raw.precision } : {}),
    ...(typeof raw.priceLabel === "boolean" ? { priceLabel: raw.priceLabel } : {}),
    ...(raw.statusValues === false ? { statusValues: false } : {}),
    ...(raw.statusInputs === false ? { statusInputs: false } : {}),
  };
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
  return def.inputs.filter((i) => i.type !== "bool").map((i) => r[i.key]).join(" ");
}
