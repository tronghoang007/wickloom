import { byId } from "@/indicators/catalog";
import { resolveInputs, type IndicatorInstance } from "@/indicators/instance";
import type { AlertCond, AlertIndicator } from "@/lib/alertsApi";

// Alert theo indicator (docs/alerts-plan.md Phase 3, mục 4). Backend tính indicator bằng bản Python (backend/app/indicators.py) nên chỉ một số indicator có alert;
// danh sách đường dưới đây phải trùng `INDICATORS[*]["plots"]` của backend (pyFixtures.test.ts kiểm hai bên cùng khớp fixture).

const SMOOTH = ["sm", "smUpper", "smLower"];
export const ALERT_PLOTS: Record<string, string[]> = {
  sma: ["sma", ...SMOOTH],
  ema: ["ema", ...SMOOTH],
  wma: ["wma"],
  rsi: ["rsi", ...SMOOTH],
  macd: ["macd", "signal", "hist"],
  bb: ["basis", "upper", "lower"],
  stoch: ["k", "d"],
};

export const supportsIndicatorAlert = (id: string) => id in ALERT_PLOTS;

/** Cách dùng hay gặp nhất của từng indicator: MA / Bollinger so với giá, RSI cắt mức 70, MACD cắt Signal, %K cắt %D. */
const DEFAULTS: Record<string, { plot: string; vs: string; level?: number }> = {
  sma: { plot: "sma", vs: "price" },
  ema: { plot: "ema", vs: "price" },
  wma: { plot: "wma", vs: "price" },
  rsi: { plot: "rsi", vs: "level", level: 70 },
  macd: { plot: "macd", vs: "signal" },
  bb: { plot: "upper", vs: "price" },
  stoch: { plot: "k", vs: "d", level: 80 },
};

export const plotTitle = (id: string, plot: string): string => byId(id).plots.find((p) => p.id === plot)?.title ?? plot;

/** Các đường của indicator đặt alert được (tên hiện trong hộp thoại). */
export const alertPlots = (id: string): { id: string; title: string }[] => (ALERT_PLOTS[id] ?? []).map((p) => ({ id: p, title: plotTitle(id, p) }));

/** "RSI 14 close"; đường khác tên indicator thì thêm "· Signal" ("MACD close 12 26 9 EMA EMA · Signal"). Chỉ các tham số chính: bỏ nhóm Smoothing và Offset cho gọn. */
export function indicatorLabel(id: string, inputs: IndicatorInstance["inputs"], plot: string): string {
  const def = byId(id);
  const resolved = resolveInputs(def, inputs);
  const params = def.inputs.filter((i) => i.type !== "bool" && !i.hideInLegend && i.group !== "Smoothing" && i.key !== "offset").map((i) => resolved[i.key]).join(" ");
  const base = `${def.name} ${params}`.trim();
  const title = plotTitle(id, plot);
  return title === def.name ? base : `${base} · ${title}`;
}

/** Thứ được so ("level" / "price" / một đường khác) hiện thành chữ. */
export const vsText = (spec: Pick<AlertIndicator, "id" | "vs" | "vs_label">): string => (spec.vs === "level" ? "Value" : spec.vs === "price" ? "Price" : (spec.vs_label ?? plotTitle(spec.id, spec.vs)));

/** Các lựa chọn "so với": một mức, giá, và mọi đường khác của indicator. */
export const vsOptions = (spec: Pick<AlertIndicator, "id" | "plot">): { value: string; label: string }[] => [
  { value: "level", label: "Value" },
  { value: "price", label: "Price" },
  ...alertPlots(spec.id).filter((p) => p.id !== spec.plot).map((p) => ({ value: p.id, label: p.title })),
];

/** Mức gợi ý bấm một lần (đường ngang của indicator: RSI 70 / 50 / 30...). */
export const levelChoices = (id: string): number[] => byId(id).levels?.map((l) => l.value) ?? [];

/** Mức mặc định khi so với một mức (null = indicator không có mức tự nhiên, vd MA). */
export const defaultLevel = (id: string): number | null => DEFAULTS[id]?.level ?? (levelChoices(id)[0] ?? null);

export const defaultCond: AlertCond = "cross";

/** Dựng alert từ indicator đang có trên chart. null nếu indicator chưa hỗ trợ. */
export function specFromInstance(inst: Pick<IndicatorInstance, "id" | "inputs">): AlertIndicator | null {
  const d = DEFAULTS[inst.id];
  if (!d) return null;
  const inputs = resolveInputs(byId(inst.id), inst.inputs);
  return { id: inst.id, inputs, plot: d.plot, vs: d.vs, label: indicatorLabel(inst.id, inputs, d.plot), vs_label: vsText({ id: inst.id, vs: d.vs, vs_label: undefined }) };
}

/** Đổi đường và / hoặc thứ được so; nhãn dựng lại. `vs` trùng với đường mới thì chuyển sang "price". */
export function withChoice(spec: AlertIndicator, plot: string, vs: string): AlertIndicator {
  const safeVs = vs === plot ? "price" : vs;
  return { ...spec, plot, vs: safeVs, label: indicatorLabel(spec.id, spec.inputs, plot), vs_label: safeVs === "level" ? "" : vsText({ id: spec.id, vs: safeVs, vs_label: undefined }) };
}

/** Đường của Smoothing (RSI-based MA, dải Bollinger của Smoothing) chỉ có số khi Smoothing bật đúng loại: nói trước thay vì để backend từ chối. */
export function smoothingHint(spec: Pick<AlertIndicator, "inputs" | "plot" | "vs">): string | null {
  for (const p of [spec.plot, spec.vs]) {
    if (!SMOOTH.includes(p)) continue;
    const type = spec.inputs.smoothType;
    if (type === "None") return "Bật Smoothing trong Settings của indicator trước (đường này chỉ có khi Smoothing không phải None).";
    if (p !== "sm" && type !== "SMA + Bollinger Bands") return "Dải Bollinger của Smoothing chỉ có khi Type là SMA + Bollinger Bands.";
  }
  return null;
}
