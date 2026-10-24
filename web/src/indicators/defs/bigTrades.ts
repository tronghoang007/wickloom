import type { Bar, TickCell } from "@/lib/api";
import { TICK_DEPTH } from "../lower";
import { indexAtTime } from "../objects";
import { num, type Ctx, type IndicatorDef, type InputDef, type ItemDef, type ObjBubble, type ObjectSet } from "../schema";
import { withAlpha } from "../style";
import { barStep } from "./pivots";

// Big Trades (bubble kiểu ATAS): mỗi bubble là một lượng tick lớn ở cùng một giá. Tick của MT5 CFD không có khối lượng từng lệnh (mỗi tick tính 1),
// nên "lệnh lớn" ở đây là ô (phút, giá) của lịch sử tick mà backend giữ (bảng tickvp) có nhiều tick: bubble nằm ở nến chứa phút đó, tại giá đó, màu theo
// bên chiếm nhiều volume hơn (quy tắc tick như CVD), cỡ theo volume, số ở giữa là tổng tick. Bubble phủ tối đa độ sâu tick (14 ngày) tính từ nến cuối.
// Giá được gom vào row (Price grouping): mã nhiều tick như BTC hiếm khi có 2 tick cùng đúng một giá trong một phút nên không gom thì bubble nào cũng chỉ 1-4 tick.

const ITEMS: ItemDef[] = [
  { id: "buy", title: "Buy", color: "#26a69a", group: "Bubbles", plain: true },
  { id: "sell", title: "Sell", color: "#f23645", group: "Bubbles", plain: true },
];

const INPUTS: InputDef[] = [
  {
    key: "min", label: "Minimum volume", type: "int", default: 0, min: 0, group: "Filter",
    tooltip: "Smallest number of ticks at one price within one minute that gets a bubble. 0 = automatic: only the biggest bubbles of the loaded range are shown (see Maximum bubbles).",
  },
  { key: "count", label: "Maximum bubbles", type: "int", default: 100, min: 1, max: 3000, group: "Filter", tooltip: "Keeps only this many of the biggest bubbles of the loaded range." },
  {
    key: "max", label: "Maximum volume", type: "int", default: 0, min: 0, group: "Filter",
    tooltip: "Volume drawn with the biggest bubble size; bigger volumes are not drawn any bigger. 0 = the biggest volume shown.",
  },
  {
    key: "group", label: "Price grouping (ticks)", type: "int", default: 0, min: 0, group: "Filter",
    tooltip: "Height of a price row in ticks: the ticks of one minute within a row make one bubble. 0 = automatic, about 1/20 of a typical candle.",
  },
  { key: "minSize", label: "Minimum size", type: "int", default: 10, min: 4, max: 200, group: "Bubbles", tooltip: "Diameter of the smallest bubble, in pixels." },
  { key: "maxSize", label: "Maximum size", type: "int", default: 48, min: 4, max: 200, group: "Bubbles", tooltip: "Diameter of the biggest bubble, in pixels." },
  { key: "opacity", label: "Opacity (%)", type: "int", default: 72, min: 5, max: 100, group: "Bubbles" },
  { key: "text", label: "Show volume", type: "bool", default: true, group: "Bubbles" },
];

/** Pha `color` (`#rrggbb`) với trắng `t` (0..1): viền bubble sáng hơn nền để tách khỏi thân nến cùng màu xanh / đỏ; màu khác định dạng giữ nguyên. */
export function lighten(color: string, t: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color.trim());
  if (!m) return color;
  const hex = m.slice(1).map((h) => Math.round(parseInt(h, 16) + (255 - parseInt(h, 16)) * t).toString(16).padStart(2, "0"));
  return `#${hex.join("")}`;
}

const compact = (v: number): string => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}K` : String(Math.round(v)));

/** Đầu khoảng cần tick: nến đầu của chart, nhưng không xa hơn độ sâu tick tính từ nến cuối (cũ hơn thì broker không còn tick). */
export const bubbleFrom = (bars: Bar[], cut: number, step: number): number | null =>
  bars.length === 0 || cut >= bars.length ? null : Math.max(bars[cut].t, bars[bars.length - 1].t + step - TICK_DEPTH);

/** Làm tròn `x` về 1 / 2 / 5 × 10^k gần nhất (theo tỉ lệ): kích thước row đổi theo nấc chứ không đổi mỗi khi có nến mới. */
export function niceStep(x: number): number {
  const k = 10 ** Math.floor(Math.log10(x));
  const m = x / k;
  return k * ([1, 2, 5, 10].reduce((best, c) => (Math.abs(Math.log(m / c)) < Math.abs(Math.log(m / best)) ? c : best)));
}

/** Chiều cao (giá) của một row gom giá: `ticks` tick nếu user đặt, không thì ~1/20 biên độ trung vị của 200 nến chart cuối (làm tròn nấc), tối thiểu 1 tick. */
export function rowSize(bars: Bar[], tick: number, ticks: number): number {
  if (ticks > 0) return ticks * tick;
  const ranges = bars.slice(-200).map((b) => b.h - b.l).sort((a, b) => a - b);
  const median = ranges[ranges.length >> 1] ?? 0;
  return median > 0 ? Math.max(1, Math.round(niceStep(median / 20) / tick)) * tick : tick;
}

/** Đường kính (px) của bubble có volume `v`: diện tích tăng theo volume từ `lo` (cỡ nhỏ nhất) tới `hi` (cỡ lớn nhất). */
export function bubbleSize(v: number, lo: number, hi: number, minSize: number, maxSize: number): number {
  const t = hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0;
  return minSize + (maxSize - minSize) * Math.sqrt(t);
}

/** Bubble của các ô tick `cells`: x = chỉ số nến chứa phút của ô (`times` tăng dần, `step` giây một nến), y = giá. Bubble lớn vẽ trước để bubble nhỏ cùng chỗ nằm trên. */
export function bubblesOf(cells: TickCell[], times: number[], step: number, c: Ctx): ObjBubble[] {
  if (cells.length === 0 || times.length === 0) return [];
  const { inputs, items } = c;
  const vols = cells.map((k) => k.up + k.dn);
  const lo = num(inputs, "min") > 0 ? num(inputs, "min") : Math.min(...vols);
  const hi = num(inputs, "max") > 0 ? num(inputs, "max") : Math.max(...vols);
  const minSize = num(inputs, "minSize");
  const maxSize = Math.max(minSize, num(inputs, "maxSize"));
  const alpha = num(inputs, "opacity") / 100;
  const text = !!inputs.text;
  return cells
    .map((k, i): ObjBubble => {
      const color = k.up >= k.dn ? items.buy.color : items.sell.color;
      return {
        x: Math.floor(indexAtTime(times, k.t, step)), y: k.p, r: bubbleSize(vols[i], lo, hi, minSize, maxSize) / 2,
        bg: withAlpha(color, alpha), border: lighten(color, 0.6), ...(text ? { text: compact(vols[i]), textColor: "#ffffff" } : {}),
      };
    })
    .sort((a, b) => b.r - a.r);
}

export const bigTrades: IndicatorDef = {
  id: "bigtrades", name: "Big Trades", title: "Big trades", overlay: true,
  inputs: INPUTS,
  plots: [],
  items: ITEMS,
  warmup: () => 0,
  compute: () => ({}),
  ticks: (_inputs, { bars, cut, step }) => {
    const from = bubbleFrom(bars, cut, step);
    return from === null ? null : { from };
  },
  objects: (c): ObjectSet => {
    const empty: ObjectSet = { lines: [], labels: [], boxes: [], bubbles: [] };
    const { bars } = c;
    const step = barStep(bars);
    const t0 = bubbleFrom(bars, c.cut, step);
    if (t0 === null || !c.ticks?.big) return empty;
    const size = rowSize(bars.slice(c.cut), c.tick, num(c.inputs, "group"));
    const cells = c.ticks.big(t0, bars[bars.length - 1].t + step, Math.max(1, num(c.inputs, "min")), num(c.inputs, "count"), size);
    return cells ? { ...empty, bubbles: bubblesOf(cells, bars.map((b) => b.t), step, c) } : empty;
  },
};
