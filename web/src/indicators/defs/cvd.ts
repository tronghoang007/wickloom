import type { Bar } from "@/lib/api";
import { periodKeys, periodStarts, type Period } from "../calendar";
import { TICK_DEPTH, TICK_TF, tickStart } from "../lower";
import { str, type IndicatorDef } from "../schema";
import { nan } from "../ta";
import { sessionInputs, withSession } from "./common";

// Cumulative Volume Delta dạng nến (Pine v6 "Cumulative volume delta" của TV, "Data aggregation = 1 tick"): mỗi nến chart là một nến O/H/L/C của delta
// tích luỹ từ đầu kỳ Anchor, tính trên từng tick của MT5 (mỗi tick = tick volume 1). Không có chế độ Time (nến khung nhỏ): chỉ tick.

const ANCHORS: Record<string, Period> = { "1D": "day", "1W": "week", "1M": "month", "12M": "year" };
const DAY = 86400;
// nến đầu mảng nằm giữa kỳ: xin tick từ sớm hơn chừng này để thấy đầu kỳ (ngày: qua được cuối tuần), trong độ sâu tick
const LOOKBACK: Record<string, number> = { "1D": 3 * DAY, "1W": 10 * DAY, "1M": 35 * DAY, "12M": 400 * DAY };

export type DeltaCandles = { o: number[]; h: number[]; l: number[]; c: number[] };

/** Delta tích luỹ từ đầu kỳ anchor tới nến chart đầu tiên `times[0]` (nến đầu mảng thường nằm giữa kỳ): cộng các phút `fine` trước nến đó cùng kỳ với nó. 0 nếu nến đầu mở đầu kỳ
 *  hoặc không có phút nào trước nó;
 *  null nếu tick không phủ tới đầu kỳ (không biết delta đầu kỳ: kỳ đó để trống). `keysOf` = khoá kỳ của một dãy thời gian tăng dần. */
export function leadDelta(times: number[], fine: Bar[], keysOf: (times: number[]) => number[]): number | null {
  if (times.length === 0) return null;
  const t0 = times[0];
  let n = 0;
  while (n < fine.length && fine[n].t < t0) n++;
  // không có phút nào trước nến đầu (trước đó là cuối tuần / giờ nghỉ, hoặc tick trước đó chưa nạp xong): coi nến đầu là đầu kỳ như trước
  if (n === 0) return 0;
  const k = keysOf([...fine.slice(0, n).map((b) => b.t), t0]);
  let s = n;
  while (s > 0 && k[s - 1] === k[n]) s--;
  if (s === 0) return null; // mọi phút đã nạp đều cùng kỳ với nến đầu: đầu kỳ còn sớm hơn
  let cum = 0;
  for (let j = s; j < n; j++) cum += fine[j].c;
  return cum;
}

/** Nến delta tích luỹ: `fine` = nến delta từng phút của tick (backend tf "TD": o = 0, c = delta phút, h / l = đỉnh / đáy delta tích luỹ trong phút) tăng dần theo t,
 *  `keys` = khoá kỳ anchor của từng nến chart, `lead` = delta từ đầu kỳ tới nến đầu (`leadDelta`; null = không biết, kỳ đầu để trống).
 *  Phút trước nến đầu không cộng vào nến đầu. Nến chart trước chỗ dữ liệu tick bắt đầu, hoặc không có phút nào bên trong, là na. */
export function cumulativeDelta(bars: Bar[], keys: number[], fine: Bar[], lead: number | null = 0): DeltaCandles {
  const n = bars.length;
  const out: DeltaCandles = { o: nan(n), h: nan(n), l: nan(n), c: nan(n) };
  if (fine.length === 0 || n === 0) return out;
  let j = 0;
  while (j < fine.length && fine[j].t < bars[0].t) j++;
  let cum = 0;
  let valid = false;
  for (let i = 0; i < n; i++) {
    const end = i + 1 < n ? bars[i + 1].t : Infinity;
    const newAnchor = i === 0 ? lead !== null : keys[i] !== keys[i - 1];
    if (!valid) {
      // chỉ bắt đầu cộng dồn ở đầu một kỳ mà dữ liệu tick đã phủ tới, nếu không delta bắt đầu giữa kỳ sẽ lệch
      if (!newAnchor || fine[0].t >= end) {
        while (j < fine.length && fine[j].t < end) j++;
        continue;
      }
      valid = true;
    }
    if (newAnchor) cum = i === 0 ? lead! : 0;
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
    const period = ANCHORS[str(inputs, "anchor")] ?? "day";
    const opts = withSession(cal, inputs);
    const starts = periodStarts(bars.map((b) => b.t), period, opts);
    const first = starts.filter((s) => s <= cut).pop() ?? 0;
    const start = tickStart(bars, starts, first, step);
    if (start === undefined) return null;
    // nến đầu mảng luôn là "đầu kỳ" của periodStarts dù thường nằm giữa kỳ: khi đó xin cả tick trước nó để tính delta từ đầu kỳ thật (leadDelta)
    const k = start === 0 ? periodKeys([bars[0].t - step, bars[0].t], period, opts) : [];
    if (k.length === 0 || k[0] !== k[1]) return { tfs: [TICK_TF], from: bars[start].t };
    const oldest = bars[bars.length - 1].t + step - TICK_DEPTH;
    return { tfs: [TICK_TF], from: Math.max(oldest, bars[0].t - (LOOKBACK[str(inputs, "anchor")] ?? 3 * DAY)) };
  },
  compute: ({ bars, inputs, lower, calendar }) => {
    const times = bars.map((b) => b.t);
    const period = ANCHORS[str(inputs, "anchor")] ?? "day";
    const cal = withSession(calendar, inputs);
    const keys = periodKeys(times, period, cal);
    // chưa nạp tới / ngoài độ sâu tick thì để trống (TV báo thiếu độ sâu tick) thay vì đoán từ nến chart
    const d = cumulativeDelta(bars, keys, lower, leadDelta(times, lower, (t) => periodKeys(t, period, cal)));
    return { cvd: { values: d.c, candle: { o: d.o, h: d.h, l: d.l } } };
  },
};
