import type { Bar } from "@/lib/api";
import { periodKeys, periodStarts, type Period } from "../calendar";
import { TICK_TF, autoLowerTf, lowerCandidates, withinBudget } from "../lower";
import { str, type IndicatorDef } from "../schema";
import { nan } from "../ta";

// Cumulative Volume Delta dạng nến (Pine v6 "Cumulative volume delta" của TV, docs/reference/cvd.pine): mỗi nến chart là một
// nến O/H/L/C của delta tích luỹ từ đầu kỳ Anchor; delta lấy từ nến khung nhỏ (volume = tick volume của MT5).

const ANCHORS: Record<string, Period> = { "1D": "day", "1W": "week", "1M": "month", "12M": "year" };
/** Ô Timeframe của TV ("1", "5", "60"...) -> tên khung của backend. */
const TF_OF: Record<string, string> = { "1": "M1", "5": "M5", "15": "M15", "30": "M30", "60": "H1", "240": "H4", D: "D1" };
const BUDGET = 100_000; // số nến khung nhỏ tối đa chấp nhận cho một lần nạp
const TICK_BUDGET = 14 * 1440; // "1 tick": tối đa chừng này phút (~3,4 triệu tick vàng) mỗi lần; xa hơn thì không tính (TV cũng báo thiếu độ sâu tick)
const TICKS = "1 tick";

/** Chiều của volume từng nến khung nhỏ: đóng > mở lên, đóng < mở xuống; đóng = mở thì so với đóng nến trước, vẫn bằng thì giữ chiều trước. */
export function barDirection(b: Bar, prevClose: number, prevDir: 1 | -1): 1 | -1 {
  if (b.c > b.o) return 1;
  if (b.c < b.o) return -1;
  return b.c > prevClose ? 1 : b.c < prevClose ? -1 : prevDir;
}

export type DeltaCandles = { o: number[]; h: number[]; l: number[]; c: number[] };

/** Nến delta tích luỹ: `fine` = nến khung nhỏ tăng dần theo t, `keys` = khoá kỳ anchor của từng nến chart. Nến chart trước chỗ dữ liệu khung nhỏ bắt đầu, hoặc không có nến khung nhỏ nào bên trong, là na.
 *  `ticks`: `fine` là nến delta từng phút của tick (backend tf "TD": o = 0, c = delta phút, h / l = đỉnh / đáy delta tích luỹ trong phút) thay vì nến giá cần phân loại. */
export function cumulativeDelta(bars: Bar[], keys: number[], fine: Bar[], ticks = false): DeltaCandles {
  const n = bars.length;
  const out: DeltaCandles = { o: nan(n), h: nan(n), l: nan(n), c: nan(n) };
  if (fine.length === 0) return out;
  let j = 0;
  let cum = 0;
  let valid = false;
  let prevClose = fine[0].o;
  let dir: 1 | -1 = 1;
  for (let i = 0; i < n; i++) {
    const end = i + 1 < n ? bars[i + 1].t : Infinity;
    const newAnchor = i === 0 || keys[i] !== keys[i - 1];
    if (!valid) {
      // chỉ bắt đầu cộng dồn ở đầu một kỳ mà dữ liệu khung nhỏ đã phủ tới, nếu không delta bắt đầu giữa kỳ sẽ lệch
      if (!newAnchor || fine[0].t >= end) {
        while (j < fine.length && fine[j].t < end) prevClose = fine[j++].c;
        continue;
      }
      valid = true;
    }
    if (newAnchor) cum = 0;
    if (!(j < fine.length && fine[j].t < end)) continue; // không có nến khung nhỏ trong nến chart này (DB thiếu): để trống, tích luỹ giữ nguyên
    let hi = cum, lo = cum;
    out.o[i] = cum;
    while (j < fine.length && fine[j].t < end) {
      const b = fine[j++];
      if (ticks) {
        hi = Math.max(hi, cum + b.h);
        lo = Math.min(lo, cum + b.l);
        cum += b.c;
        continue;
      }
      dir = barDirection(b, prevClose, dir);
      prevClose = b.c;
      cum += dir * b.v;
      hi = Math.max(hi, cum);
      lo = Math.min(lo, cum);
    }
    out.h[i] = hi;
    out.l[i] = lo;
    out.c[i] = cum;
  }
  return out;
}

export const cvd: IndicatorDef = {
  id: "cvd", name: "CVD", title: "Cumulative volume delta", overlay: false, format: "volume",
  inputs: [
    { key: "anchor", label: "Anchor period", type: "select", default: "1D", options: Object.keys(ANCHORS) },
    { key: "agg", label: "Data aggregation", type: "select", default: "Time", options: ["Time", TICKS], tooltip: "Defines how lower timeframe data is aggregated for the delta calculation. \"1 tick\" computes the delta on tick data (the broker's tick history, requested from MetaTrader; each tick counts as tick volume 1) and covers only a few weeks." },
    { key: "custom", label: "Use custom timeframe", type: "bool", default: false, enabledIf: (i) => i.agg !== TICKS, tooltip: "The indicator scans lower timeframe data to approximate up and down volume used in the delta calculation. By default, the timeframe is chosen automatically. Higher timeframes provide more historical data, but the data will be less precise." },
    { key: "tf", label: "Timeframe", type: "select", default: "1", options: Object.keys(TF_OF), enabledIf: (i) => !!i.custom && i.agg !== TICKS },
  ],
  plots: [{ id: "cvd", title: "CVD", type: "candles", color: "#089981", colorDown: "#f23645" }],
  levels: [{ id: "zero", title: "Zero", value: 0, color: "#787b86" }],
  warmup: () => 0,
  needsCalendar: true,
  lower: (inputs, { bars, cut, step, calendar }) => {
    if (bars.length === 0) return null;
    if (inputs.agg === TICKS) {
      const start = periodStarts(bars.map((b) => b.t), ANCHORS[str(inputs, "anchor")] ?? "day", calendar).filter((s) => s <= cut).pop() ?? 0;
      const from = bars[start].t;
      return (bars[bars.length - 1].t + step - from) / 60 <= TICK_BUDGET ? { tfs: [TICK_TF], from } : null;
    }
    const first = inputs.custom ? TF_OF[str(inputs, "tf")] : autoLowerTf(step);
    // tự chọn thì được lùi sang khung thô hơn ở vùng M1 không còn; tự chọn khung riêng thì dùng đúng khung đó
    const cands = lowerCandidates(step, first);
    const tfs = inputs.custom ? cands.slice(0, 1) : cands;
    const starts = periodStarts(bars.map((b) => b.t), ANCHORS[str(inputs, "anchor")] ?? "day", calendar);
    const start = starts.filter((s) => s <= cut).pop() ?? 0; // đầu kỳ chứa nến đầu tiên của chart
    const from = bars[start].t;
    const ok = withinBudget(tfs, from, bars[bars.length - 1].t + step, BUDGET);
    return ok.length ? { tfs: ok, from } : null;
  },
  compute: ({ bars, inputs, lower, calendar }) => {
    const keys = periodKeys(bars.map((b) => b.t), ANCHORS[str(inputs, "anchor")] ?? "day", calendar);
    // "1 tick": chỉ dùng nến delta theo tick; chưa nạp tới / ngoài độ sâu tick thì để trống (TV báo thiếu độ sâu tick) thay vì đoán từ nến chart
    if (inputs.agg === TICKS) {
      const t = cumulativeDelta(bars, keys, lower, true);
      return { cvd: { values: t.c, candle: { o: t.o, h: t.h, l: t.l } } };
    }
    // chart khung nhỏ nhất (không có khung nhỏ hơn) hoặc không tải được: dùng chính nến chart
    const fine = lower.length > 0 ? lower : bars;
    const d = cumulativeDelta(bars, keys, fine);
    return { cvd: { values: d.c, candle: { o: d.o, h: d.h, l: d.l } } };
  },
};

