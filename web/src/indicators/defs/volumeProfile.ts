import type { Bar } from "@/lib/api";
import { computeProfile, computeTickProfile, profileLevels, type Profile } from "@/volumeProfile/compute";
import { periodKeys, periodStarts, type Period } from "../calendar";
import { TICK_DEPTH, lowerCandidates, overlaps, tickStart, withinBudget } from "../lower";
import { num, str, type Ctx, type IndicatorDef, type InputDef, type ItemDef, type PlacedProfile, type ProfileSet, type ProfileStyle } from "../schema";
import { TF_SECONDS } from "@/lib/api";
import { sessionInputs, withSession } from "./common";
import { barStep, groupPeriods } from "./pivots";

// Session Volume Profile và Visible Range Volume Profile: cùng họ với FRVP / AVP của drawings (volumeProfile/compute.ts),
// volume chia theo nến khung nhỏ (LowerFeed) như TV, nơi thiếu thì dùng nến chart.
// "Data aggregation = 1 tick" (mở rộng so với TV): mỗi tick rơi đúng vào row chứa giá của nó, lên / xuống theo quy tắc tick như CVD; nơi chưa có tick
// (ngoài độ sâu tick của broker, hoặc chưa nạp xong) dùng nến như trên.

const BUDGET = 100_000;
const SESSIONS: Record<string, Period> = { Day: "day", Week: "week", Month: "month" };

const layoutInput: InputDef = { key: "layout", label: "Rows Layout", type: "select", default: "Number Of Rows", options: ["Number Of Rows", "Ticks Per Row"] };
const rowsInput: InputDef = { key: "rows", label: "Row Size", type: "int", default: 24, min: 1, max: 1000 };
const volumeInput: InputDef = { key: "volume", label: "Volume", type: "select", default: "Up/Down", options: ["Up/Down", "Total", "Delta", "Delta + Total"] };
const TICKS = "1 tick";
const aggInput: InputDef = {
  key: "agg", label: "Data aggregation", type: "select", default: TICKS, options: ["Time", TICKS],
  tooltip: "Defines how volume is assigned to price rows. \"Time\" splits the volume of lower timeframe candles over their price range. \"1 tick\" puts every tick on the row of its price (the broker's tick history, requested from MetaTrader; each tick counts as tick volume 1) and covers only the last few weeks; older data uses candles.",
};
const vaInput: InputDef = { key: "va", label: "Value Area Volume", type: "int", default: 70, min: 1, max: 100 };
const widthInput = (d: number, of = "box"): InputDef => ({ key: "width", label: `Width (% of the ${of})`, type: "int", default: d, min: 1, max: 100 });
const placeInput = (d: string): InputDef => ({ key: "place", label: "Placement", type: "select", default: d, options: ["Left", "Right"] });
const valuesInput: InputDef = { key: "values", label: "Values", type: "bool", default: false };

const ITEMS: ItemDef[] = [
  { id: "up", title: "Up Volume", color: "#26a69a", group: "Profile", plain: true },
  { id: "down", title: "Down Volume", color: "#f23645", group: "Profile", plain: true },
  { id: "vaUp", title: "Value Area Up", color: "#00bcd4", group: "Profile", plain: true },
  { id: "vaDown", title: "Value Area Down", color: "#e91e63", group: "Profile", plain: true },
  { id: "vah", title: "VAH", color: "#2962ff", group: "Lines", line: { width: 1, style: "dashed" } },
  { id: "val", title: "VAL", color: "#2962ff", group: "Lines", line: { width: 1, style: "dashed" } },
  { id: "poc", title: "POC", color: "#ff9800", group: "Lines", line: { width: 2, style: "solid" } },
];

function styleOf(c: Ctx, pinned: boolean): ProfileStyle {
  const { inputs, items } = c;
  const line = (id: string) => ({ show: items[id].visible, color: items[id].color, width: items[id].width, style: items[id].style });
  return {
    volume: ({ Total: "total", Delta: "delta", "Delta + Total": "deltatotal" } as const)[str(inputs, "volume") as "Total" | "Delta" | "Delta + Total"] ?? "updown",
    width: num(inputs, "width"),
    place: str(inputs, "place") === "Right" ? "right" : "left",
    values: !!inputs.values,
    extend: !!inputs.extend,
    pinned,
    up: items.up.color, down: items.down.color, vaUp: items.vaUp.color, vaDown: items.vaDown.color,
    poc: line("poc"), vah: line("vah"), val: line("val"),
  };
}

/** Nến để tính volume của khoảng [t0, t1): nến khung nhỏ có trong khoảng, cộng nến chart ở chỗ không có nến khung nhỏ nào (đầu / đuôi chưa phủ tới, lỗ hổng). */
export function profileSource(chart: Bar[], lower: Bar[], t0: number, t1: number, step: number): Bar[] {
  let lo = 0;
  let hi = lower.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lower[mid].t < t0) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < lower.length && lower[end].t < t1) end++;
  const fine = lower.slice(lo, end);
  if (fine.length === 0) return chart.filter((b) => b.t >= t0 && b.t < t1);
  const fill = chart.filter((b) => b.t >= t0 && b.t < t1 && !overlaps(fine, b.t, b.t + step));
  const rest = liveRest(chart, fine, t0, t1);
  if (rest) fill.push(rest);
  return fill.length === 0 ? fine : [...fine, ...fill].sort((a, b) => a.t - b.t);
}

/** Nến khung nhỏ chỉ đọc lại mỗi 15 giây, nến chart cuối (đang chạy) mới theo từng tick: phần nến chart đó có mà nến khung nhỏ bên trong chưa có (volume thêm, đỉnh / đáy mới)
 *  thành một nến phụ sau nến khung nhỏ cuối, giữ nguyên phần chi tiết của khung nhỏ. null nếu không thiếu gì. */
function liveRest(chart: Bar[], fine: Bar[], t0: number, t1: number): Bar | null {
  const last = chart[chart.length - 1];
  if (!last || last.t < t0 || last.t >= t1) return null;
  let v = 0, h = -Infinity, l = Infinity;
  let tail: Bar | undefined;
  for (const b of fine) {
    if (b.t < last.t) continue;
    v += b.v;
    h = Math.max(h, b.h);
    l = Math.min(l, b.l);
    tail = b;
  }
  if (!tail) return null; // không có nến khung nhỏ nào trong nến cuối: nến chart đã được lấy nguyên
  const more = last.v - v;
  if (!(more > 0) && last.h <= h && last.l >= l) return null;
  // phần sau nến khung nhỏ cuối chạy từ giá đóng của nó tới giá hiện tại, cộng đỉnh / đáy mới nếu có
  return { t: tail.t + 1, o: tail.c, h: last.h > h ? last.h : Math.max(tail.c, last.c), l: last.l < l ? last.l : Math.min(tail.c, last.c), c: last.c, v: Math.max(0, more) };
}

/** Chỉ số nến đầu tiên từ `from` trở đi mà vùng giá [l, h] chứa mức của từng đường POC / VAH / VAL (đường không có nến nào cắt thì không có khoá): đường "Extend" dừng ở đó như TV. */
export function crossings(vp: Profile, bars: Bar[], from: number): NonNullable<PlacedProfile["end"]> {
  const end: NonNullable<PlacedProfile["end"]> = {};
  const todo = profileLevels(vp);
  for (let i = from; i < bars.length && todo.length > 0; i++) {
    for (let k = todo.length - 1; k >= 0; k--) {
      if (bars[i].l <= todo[k].price && todo[k].price <= bars[i].h) {
        end[todo[k].kind] = i;
        todo.splice(k, 1);
      }
    }
  }
  return end;
}

const layoutKind = (c: Ctx) => (str(c.inputs, "layout") === "Ticks Per Row" ? "ticks" : "rows");

const compute = (c: Ctx, src: Bar[]) => computeProfile(src, c.tick, num(c.inputs, "rows"), num(c.inputs, "va"), layoutKind(c));

/** Profile của nến chart `chart` (khoảng [t0, t1)): tick nếu có, không thì nến khung nhỏ / nến chart. */
const profileOf = (c: Ctx, chart: Bar[], t0: number, t1: number, step: number) =>
  (c.inputs.agg === TICKS && c.ticks ? computeTickProfile(c.ticks, chart, t0, t1, c.tick, num(c.inputs, "rows"), num(c.inputs, "va"), layoutKind(c)) : null) ??
  compute(c, profileSource(chart, c.lower, t0, t1, step));

export const svp: IndicatorDef = {
  id: "svp", name: "SVP", title: "Session volume profile", overlay: true,
  inputs: [
    layoutInput, rowsInput, volumeInput, vaInput, aggInput,
    { key: "session", label: "Session", type: "select", default: "Day", options: Object.keys(SESSIONS) },
    ...sessionInputs(),
    widthInput(30), placeInput("Left"), valuesInput,
    { key: "extend", label: "Extend POC/VAH/VAL", type: "bool", default: false, tooltip: "Extends the lines to the right until a candle crosses them (to the edge of the chart if none does)." },
  ],
  plots: [],
  items: ITEMS,
  needsCalendar: true,
  warmup: () => 0,
  compute: () => ({}),
  lower: (inputs, { bars, cut, step, calendar }) => {
    if (bars.length === 0 || step >= 86400) return null;
    const starts = periodStarts(bars.map((b) => b.t), SESSIONS[str(inputs, "session")] ?? "day", withSession(calendar, inputs));
    const from = bars[starts.filter((s) => s <= cut).pop() ?? 0].t; // đầu phiên chứa nến đầu tiên của chart
    const tfs = withinBudget(lowerCandidates(step, "M1"), from, bars[bars.length - 1].t + step, BUDGET);
    return tfs.length ? { tfs, from } : null;
  },
  ticks: (inputs, { bars, cut, step, calendar }) => {
    if (inputs.agg !== TICKS || bars.length === 0 || step >= 86400) return null;
    const starts = periodStarts(bars.map((b) => b.t), SESSIONS[str(inputs, "session")] ?? "day", withSession(calendar, inputs));
    // phiên cũ hơn độ sâu tick không tính bằng tick (dùng nến), phiên đầu tiên trong độ sâu bắt đầu nạp tick
    const start = tickStart(bars, starts, starts.filter((s) => s <= cut).pop() ?? 0, step);
    return start === undefined ? null : { from: bars[start].t };
  },
  profiles: (c): ProfileSet => {
    const { bars } = c;
    const style = styleOf(c, false);
    if (bars.length === 0) return { profiles: [], style };
    const step = barStep(bars);
    if (step >= 86400) return { profiles: [], style }; // từ D1 trở lên không có phiên để chia
    const sessions = groupPeriods(bars, periodKeys(bars.map((b) => b.t), SESSIONS[str(c.inputs, "session")] ?? "day", withSession(c.calendar, c.inputs)));
    const profiles: PlacedProfile[] = [];
    for (const s of sessions) {
      if (s.last < c.cut) continue; // phiên nằm hẳn trong lịch sử ẩn
      const vp = profileOf(c, bars.slice(s.first, s.last + 1), bars[s.first].t, bars[s.last].t + step, step);
      if (vp) profiles.push({ ...vp, x1: s.first, x2: s.last, ...(c.inputs.extend ? { end: crossings(vp, bars, s.last + 1) } : {}) });
    }
    return { profiles, style };
  },
};

/** Khung nhỏ đầu tiên (M1…D1, nhỏ hơn khung chart) mà vùng `seconds` giây có dưới 5000 nến, như FRVP của TV. */
export const rangeLowerTf = (step: number, seconds: number): string | null =>
  lowerCandidates(step, "M1").find((tf) => seconds / TF_SECONDS[tf] < 5000) ?? null;

export const vrvp: IndicatorDef = {
  id: "vrvp", name: "VRVP", title: "Visible range volume profile", overlay: true,
  inputs: [layoutInput, rowsInput, volumeInput, vaInput, aggInput, widthInput(30, "pane"), placeInput("Right"), valuesInput],
  plots: [],
  items: ITEMS.map((it) => (it.id === "vah" || it.id === "val" ? { ...it, line: { width: 1, style: "dashed" as const } } : it)),
  needsRange: true,
  warmup: () => 0,
  compute: () => ({}),
  lower: (_inputs, { bars, step, range }) => {
    if (!range || bars.length === 0 || range.to <= range.from) return null;
    const from = bars[range.from].t;
    const to = bars[range.to].t + step;
    const first = rangeLowerTf(step, to - from);
    if (!first) return null;
    const tfs = withinBudget(lowerCandidates(step, first), from, to, BUDGET);
    return tfs.length ? { tfs, from } : null;
  },
  ticks: (inputs, { bars, step, range }) => {
    if (inputs.agg !== TICKS || !range || bars.length === 0 || range.to <= range.from) return null;
    const from = bars[range.from].t;
    return bars[bars.length - 1].t + step - from <= TICK_DEPTH ? { from } : null; // cả vùng nhìn phải nằm trong độ sâu tick, không thì dùng nến
  },
  profiles: (c): ProfileSet => {
    const { bars } = c;
    const style = styleOf(c, true);
    if (bars.length === 0) return { profiles: [], style };
    const step = barStep(bars);
    const from = c.range?.from ?? c.cut;
    const to = c.range?.to ?? bars.length - 1;
    if (to < from) return { profiles: [], style };
    const vp = profileOf(c, bars.slice(from, to + 1), bars[from].t, bars[to].t + step, step);
    return { profiles: vp ? [{ ...vp, x1: from, x2: to }] : [], style };
  },
};
