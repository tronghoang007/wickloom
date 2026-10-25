import type { Bar } from "@/lib/api";
import { periodKeys, periodStarts, type Period } from "../calendar";
import { TICK_TF, tickStart } from "../lower";
import { str, type IndicatorDef } from "../schema";
import { nan } from "../ta";
import { sessionInputs, withSession } from "./common";

// Cumulative Volume Delta dạng nến (Pine v6 "Cumulative volume delta" của TV, "Data aggregation = 1 tick"): mỗi nến chart là một nến O/H/L/C của delta
// tích luỹ từ đầu kỳ Anchor, tính trên từng tick của MT5 (mỗi tick = tick volume 1). Không có chế độ Time (nến khung nhỏ): chỉ tick.

const ANCHORS: Record<string, Period> = { "1D": "day", "1W": "week", "1M": "month", "12M": "year" };

export type DeltaCandles = { o: number[]; h: number[]; l: number[]; c: number[] };

/** Nến delta tích luỹ: `fine` = nến delta từng phút của tick (backend tf "TD": o = 0, c = delta phút, h / l = đỉnh / đáy delta tích luỹ trong phút) tăng dần theo t,
 *  `keys` = khoá kỳ anchor của từng nến chart. Nến chart trước chỗ dữ liệu tick bắt đầu, hoặc không có phút nào bên trong, là na. */
export function cumulativeDelta(bars: Bar[], keys: number[], fine: Bar[]): DeltaCandles {
  const n = bars.length;
  const out: DeltaCandles = { o: nan(n), h: nan(n), l: nan(n), c: nan(n) };
  if (fine.length === 0) return out;
  let j = 0;
  let cum = 0;
  let valid = false;
  for (let i = 0; i < n; i++) {
    const end = i + 1 < n ? bars[i + 1].t : Infinity;
    const newAnchor = i === 0 || keys[i] !== keys[i - 1];
    if (!valid) {
      // chỉ bắt đầu cộng dồn ở đầu một kỳ mà dữ liệu tick đã phủ tới, nếu không delta bắt đầu giữa kỳ sẽ lệch
      if (!newAnchor || fine[0].t >= end) {
        while (j < fine.length && fine[j].t < end) j++;
        continue;
      }
      valid = true;
    }
    if (newAnchor) cum = 0;
    if (!(j < fine.length && fine[j].t < end)) continue; // không có phút nào trong nến chart này (DB thiếu): để trống, tích luỹ giữ nguyên
    let hi = cum, lo = cum;
    out.o[i] = cum;
    while (j < fine.length && fine[j].t < end) {
      const b = fine[j++];
      hi = Math.max(hi, cum + b.h);
      lo = Math.min(lo, cum + b.l);
      cum += b.c;
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
    {
      key: "anchor", label: "Anchor period", type: "select", default: "1D", options: Object.keys(ANCHORS),
      tooltip: "The delta resets at the start of each anchor period. It is computed on the broker's tick history (requested from MetaTrader; each tick counts as tick volume 1), which covers only a few weeks: a period that began earlier than that stays empty.",
    },
    ...sessionInputs(),
  ],
  plots: [{ id: "cvd", title: "CVD", type: "candles", color: "#089981", colorDown: "#f23645" }],
  levels: [{ id: "zero", title: "Zero", value: 0, color: "#787b86" }],
  warmup: () => 0,
  needsCalendar: true,
  lower: (inputs, { bars, cut, step, calendar: cal }) => {
    if (bars.length === 0) return null;
    // chart nạp cả tháng nến nhưng chỉ độ sâu tick gần đây mới tính được: bắt đầu từ kỳ đầu tiên nằm trong ngân sách, nến chart cũ hơn để trống
    const starts = periodStarts(bars.map((b) => b.t), ANCHORS[str(inputs, "anchor")] ?? "day", withSession(cal, inputs));
    const first = starts.filter((s) => s <= cut).pop() ?? 0;
    const start = tickStart(bars, starts, first, step);
    return start === undefined ? null : { tfs: [TICK_TF], from: bars[start].t };
  },
  compute: ({ bars, inputs, lower, calendar }) => {
    const keys = periodKeys(bars.map((b) => b.t), ANCHORS[str(inputs, "anchor")] ?? "day", withSession(calendar, inputs));
    // chưa nạp tới / ngoài độ sâu tick thì để trống (TV báo thiếu độ sâu tick) thay vì đoán từ nến chart
    const d = cumulativeDelta(bars, keys, lower);
    return { cvd: { values: d.c, candle: { o: d.o, h: d.h, l: d.l } } };
  },
};
