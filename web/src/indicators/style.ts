import type { FillDef, FillRef, IndicatorDef, LevelDef, LineStyleName, PlotDef, PlotType } from "./schema";
import type { IndicatorInstance } from "./instance";

// Style hiệu lực của plot / level / fill = phần user đã đặt đè lên mặc định của def.

export const PLOT_TYPES: { id: PlotType; label: string }[] = [
  { id: "line", label: "Line" },
  { id: "step", label: "Step line" },
  { id: "histogram", label: "Histogram" },
  { id: "area", label: "Area" },
  { id: "circles", label: "Circles" },
];
export const LINE_STYLES: { id: LineStyleName; label: string }[] = [
  { id: "solid", label: "Solid" },
  { id: "dashed", label: "Dashed" },
  { id: "dotted", label: "Dotted" },
];
export const WIDTHS = [1, 2, 3, 4] as const;

export type PlotStyleR = { color: string; colorDown: string; width: number; lineStyle: LineStyleName; type: PlotType; visible: boolean };
export type LevelStyleR = { value: number; color: string; width: number; lineStyle: LineStyleName; visible: boolean };
export type FillStyleR = { color: string; visible: boolean };

export function plotStyle(inst: IndicatorInstance, p: PlotDef): PlotStyleR {
  const u = inst.style?.plots?.[p.id];
  return {
    color: u?.color ?? p.color,
    colorDown: u?.colorDown ?? p.colorDown ?? u?.color ?? p.color,
    width: u?.width ?? p.width ?? 1,
    lineStyle: u?.lineStyle ?? p.lineStyle ?? "solid",
    type: p.perBar || p.type === "candles" ? p.type : (u?.type ?? p.type),
    visible: u?.visible !== false,
  };
}

export function levelStyle(inst: IndicatorInstance, l: LevelDef): LevelStyleR {
  const u = inst.style?.levels?.[l.id];
  return {
    value: u?.value ?? l.value,
    color: u?.color ?? l.color,
    width: u?.width ?? l.width ?? 1,
    lineStyle: u?.lineStyle ?? l.lineStyle ?? "dashed",
    visible: u?.visible !== false,
  };
}

export function fillStyle(inst: IndicatorInstance, f: FillDef): FillStyleR {
  const u = inst.style?.fills?.[f.id];
  return { color: u?.color ?? f.color, visible: u?.visible !== false };
}

/** Một vùng tô có vẽ được không: chưa tắt, và hai đầu (plot / level) đang hiện. */
export function fillShown(inst: IndicatorInstance, def: IndicatorDef, f: FillDef): boolean {
  if (!fillStyle(inst, f).visible) return false;
  return f.between.every((r) => refShown(inst, def, r));
}

function refShown(inst: IndicatorInstance, def: IndicatorDef, r: FillRef): boolean {
  if ("plot" in r) return inst.style?.plots?.[r.plot]?.visible !== false;
  const l = def.levels?.find((x) => x.id === r.level);
  return !!l && levelStyle(inst, l).visible;
}

/** `#rrggbb` / `#rrggbbaa` -> cùng màu với alpha mới (0..1); màu khác định dạng giữ nguyên. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color.trim());
  if (!m) return color;
  return `#${m[1]}${Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, "0")}`;
}

/** Alpha của `#rrggbbaa` (1 nếu không có). */
export function alphaOf(color: string): number {
  const m = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(color.trim());
  return m ? parseInt(m[1], 16) / 255 : 1;
}
