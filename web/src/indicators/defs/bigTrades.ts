import type { Bar, TickCell } from "@/lib/api";
import { TICK_DEPTH } from "../lower";
import { indexAtTime } from "../objects";
import { num, type Ctx, type IndicatorDef, type InputDef, type ItemDef, type ObjBubble, type ObjectSet } from "../schema";
import { withAlpha } from "../style";
import { barStep } from "./pivots";

// Big Trades (bubble kiểu ATAS, cách vẽ theo DeepCharts: Hollow Fill, Min/Max Opacity, Text Size/Color, cỡ theo Standard Deviation): mỗi bubble là một lượng tick lớn ở cùng một giá. Tick của MT5 CFD không có khối lượng từng lệnh (mỗi tick tính 1),
// nên "lệnh lớn" ở đây là ô (phút, giá) của lịch sử tick mà backend giữ (bảng tickvp) có nhiều tick: bubble nằm ở nến chứa phút đó, tại giá đó, màu theo
// bên chiếm nhiều volume hơn (quy tắc tick như CVD), cỡ theo volume, số ở giữa là tổng tick. Bubble phủ tối đa độ sâu tick (14 ngày) tính từ nến cuối.
// Giá được gom vào row (Price grouping): mã nhiều tick như BTC hiếm khi có 2 tick cùng đúng một giá trong một phút nên không gom thì bubble nào cũng chỉ 1-4 tick.

const ITEMS: ItemDef[] = [
  { id: "buy", title: "Buy", color: "#26a69a", group: "Bubbles", plain: true },
  { id: "sell", title: "Sell", color: "#f23645", group: "Bubbles", plain: true },
  { id: "text", title: "Volume text", color: "#ffffff", group: "Bubbles", plain: true },
];

const INPUTS: InputDef[] = [
  {
    key: "min", label: "Minimum volume", type: "int", default: 0, min: 0, group: "Filter",
    tooltip: "Smallest number of ticks at one price within one minute that gets a bubble. 0 = automatic: only the biggest bubbles of the visible range are shown (see Maximum bubbles).",
  },
  {
    key: "count", label: "Maximum bubbles", type: "int", default: 100, min: 1, max: 3000, group: "Filter",
    tooltip: "Keeps only this many of the biggest bubbles of the visible range, so every part of the chart gets its own biggest bubbles when you scroll. When you zoom in there are fewer (about one per two candles), so zooming does not bring in small bubbles.",
  },
  {
    key: "max", label: "Maximum volume", type: "int", default: 0, min: 0, group: "Filter",
    tooltip: "Volume drawn with the biggest bubble size; bigger volumes are not drawn any bigger. 0 = the biggest volume shown. Used only when Standard deviation is 0.",
    enabledIf: (i) => num(i, "dev") === 0,
  },
  {
    key: "group", label: "Price grouping (ticks)", type: "int", default: 0, min: 0, group: "Filter",
    tooltip: "Height of a price row in ticks: the ticks of one minute within a row make one bubble. 0 = automatic, about 1/20 of a typical candle.",
  },
  { key: "minSize", label: "Minimum size", type: "int", default: 5, min: 4, max: 200, group: "Bubbles", tooltip: "Diameter of the smallest bubble, in pixels." },
  { key: "maxSize", label: "Maximum size", type: "int", default: 50, min: 4, max: 200, group: "Bubbles", tooltip: "Diameter of the biggest bubble, in pixels." },
  {
    key: "dev", label: "Standard deviation", type: "float", default: 2, min: 0, max: 10, step: 0.5, group: "Bubbles",
    tooltip: "Size scaling: the average bubble gets the middle size and a bubble this many standard deviations above (below) the average gets the maximum (minimum) size, so a few huge bubbles do not shrink all the others. 0 = by area between Minimum and Maximum volume.",
  },
  { key: "opacityMin", label: "Minimum opacity (%)", type: "int", default: 40, min: 5, max: 100, group: "Bubbles", tooltip: "Opacity of the smallest bubble; bigger bubbles get more opaque." },
  { key: "opacityMax", label: "Maximum opacity (%)", type: "int", default: 90, min: 5, max: 100, group: "Bubbles", tooltip: "Opacity of the biggest bubble." },
  { key: "hollow", label: "Hollow fill", type: "bool", default: false, group: "Bubbles", tooltip: "Draw only the outline of each bubble." },
  { key: "text", label: "Show volume", type: "bool", default: true, group: "Bubbles" },
  { key: "textSize", label: "Text size", type: "int", default: 11, min: 6, max: 40, group: "Bubbles", enabledIf: (i) => !!i.text },
];

/** Pha `color` (`#rrggbb`) với trắng `t` (0..1): viền bubble sáng hơn nền để tách khỏi thân nến cùng màu xanh / đỏ; màu khác định dạng giữ nguyên. */
export function lighten(color: string, t: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color.trim());
  if (!m) return color;
  const hex = m.slice(1).map((h) => Math.round(parseInt(h, 16) + (255 - parseInt(h, 16)) * t).toString(16).padStart(2, "0"));
  return `#${hex.join("")}`;
}

const compact = (v: number): string => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}K` : String(Math.round(v)));

/** Số ô lớn nhất đọc về cho cả khoảng đã nạp (bằng giới hạn của /tickbig): `count` bubble của vùng đang nhìn được chọn từ đây nên kéo / zoom không phải hỏi lại backend. */
export const BIG_POOL = 5000;

/** Số bubble tối đa cho `visibleBars` nến đang nhìn: `count` khi nhìn từ `1 / BUBBLES_PER_BAR` × `count` nến trở lên, zoom gần hơn thì ít đi theo số nến (không thì `count` bubble dồn vào vài nến, kéo cả ô nhỏ vào). */
export const BUBBLES_PER_BAR = 0.5;
export const visibleCap = (count: number, visibleBars: number): number => Math.max(1, Math.min(count, Math.ceil(visibleBars * BUBBLES_PER_BAR)));

/** `count` ô lớn nhất (volume giảm dần, bằng nhau thì phút mới hơn trước) trong số các ô có phút nằm trong [from, to). */
export function topInRange(cells: TickCell[], from: number, to: number, count: number): TickCell[] {
  return cells.filter((k) => k.t >= from && k.t < to).sort((a, b) => b.up + b.dn - (a.up + a.dn) || b.t - a.t).slice(0, count);
}

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

/** Phần (0..1) giữa cỡ nhỏ nhất và lớn nhất của bubble có volume `v`: diện tích tăng theo volume từ `lo` tới `hi`. */
const areaFrac = (v: number, lo: number, hi: number): number => Math.sqrt(hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0);

/** Đường kính (px) của bubble có volume `v`: diện tích tăng theo volume từ `lo` (cỡ nhỏ nhất) tới `hi` (cỡ lớn nhất). */
export function bubbleSize(v: number, lo: number, hi: number, minSize: number, maxSize: number): number {
  return minSize + (maxSize - minSize) * areaFrac(v, lo, hi);
}

/** Phần (0..1) giữa cỡ nhỏ nhất và lớn nhất của từng bubble. `dev` > 0: theo độ lệch chuẩn của volume `ref` (trung bình = giữa, ±`dev` độ lệch chuẩn = hai đầu) để vài bubble khổng lồ không ép mọi bubble khác về cỡ nhỏ nhất;
 *  `dev` = 0: theo diện tích giữa `lo` và `hi`. Mọi bubble cùng volume thì cùng ở giữa. `ref` là tập volume làm thang (mặc định chính `vols`): thang cố định thì zoom / kéo không đổi cỡ của một bubble. */
export function sizeFractions(vols: number[], lo: number, hi: number, dev: number, ref: number[] = vols): number[] {
  if (dev <= 0) return vols.map((v) => areaFrac(v, lo, hi));
  const mean = ref.reduce((a, b) => a + b, 0) / ref.length;
  const sd = Math.sqrt(ref.reduce((a, b) => a + (b - mean) ** 2, 0) / ref.length);
  return vols.map((v) => (sd > 0 ? Math.min(1, Math.max(0, 0.5 + (v - mean) / (2 * dev * sd))) : 0.5));
}

/** Vị trí ngang (chỉ số nến, lẻ) của bubble phút `t` (UTC giây): trong nến chứa nó ở đúng chỗ của phút đó (nến trải từ chỉ số - 0,5 tới + 0,5, tâm phút = `t` + 30 giây), nên các phút của cùng một nến M5 / M15
 *  cùng row giá không chồng đúng lên nhau; nến M1 thì đúng tâm nến. */
export function bubbleX(times: number[], t: number, step: number): number {
  const i = Math.floor(indexAtTime(times, t, step));
  const start = times[i];
  return start === undefined ? i : i - 0.5 + Math.min(1, Math.max(0, (t + 30 - start) / step));
}

/** Bubble của các ô tick `cells`: x = vị trí của phút của ô trong nến chứa nó (`times` tăng dần, `step` giây một nến), y = giá. Bubble lớn vẽ trước để bubble nhỏ cùng chỗ nằm trên.
 *  Cỡ và độ đậm tính theo `ref` (các ô lớn nhất của đoạn cuối chart, mặc định chính `cells`) chứ không theo riêng các ô đang nhìn, nên zoom / kéo chart không làm đổi cỡ một bubble. */
export function bubblesOf(cells: TickCell[], times: number[], step: number, c: Ctx, ref: TickCell[] = cells): ObjBubble[] {
  if (cells.length === 0 || times.length === 0) return [];
  const { inputs, items } = c;
  const vols = cells.map((k) => k.up + k.dn);
  const refVols = ref.length > 0 ? ref.map((k) => k.up + k.dn) : vols;
  const lo = num(inputs, "min") > 0 ? num(inputs, "min") : Math.min(...refVols);
  const hi = num(inputs, "max") > 0 ? num(inputs, "max") : Math.max(...refVols);
  const minSize = num(inputs, "minSize");
  const maxSize = Math.max(minSize, num(inputs, "maxSize"));
  const opMin = num(inputs, "opacityMin") / 100;
  const opMax = Math.max(opMin, num(inputs, "opacityMax") / 100);
  const hollow = !!inputs.hollow;
  const text = !!inputs.text;
  const fr = sizeFractions(vols, lo, hi, num(inputs, "dev"), refVols);
  return cells
    .map((k, i): ObjBubble => {
      const color = k.up >= k.dn ? items.buy.color : items.sell.color;
      const alpha = opMin + (opMax - opMin) * fr[i]; // bubble càng lớn càng đậm
      return {
        x: bubbleX(times, k.t, step), y: k.p, r: (minSize + (maxSize - minSize) * fr[i]) / 2,
        ...(hollow ? { bg: withAlpha(color, 0), border: withAlpha(color, alpha), borderWidth: 2 } : { bg: withAlpha(color, alpha), border: lighten(color, 0.6) }),
        ...(text ? { text: compact(vols[i]), textColor: items.text.color, textSize: num(inputs, "textSize") } : {}),
      };
    })
    .sort((a, b) => b.r - a.r);
}

export const bigTrades: IndicatorDef = {
  id: "bigtrades", name: "Big Trades", title: "Big trades", overlay: true,
  inputs: INPUTS,
  plots: [],
  items: ITEMS,
  needsRange: true,
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
    const min = Math.max(1, num(c.inputs, "min"));
    const count = num(c.inputs, "count");
    const pool = c.ticks.big(t0, bars[bars.length - 1].t + step, min, BIG_POOL, size);
    if (!pool) return empty;
    // top `count` của vùng đang nhìn (chưa biết vùng nhìn thì cả chart)
    const v0 = Math.max(t0, bars[Math.max(c.cut, c.range?.from ?? c.cut)].t);
    const v1 = bars[Math.min(bars.length - 1, c.range?.to ?? bars.length - 1)].t + step;
    if (v1 <= v0) return empty;
    // zoom gần thì ít bubble hơn (visibleCap); cỡ tính theo ô lớn nhất của cả chart nên không đổi theo vùng nhìn
    const cap = visibleCap(count, Math.min(bars.length - 1, c.range?.to ?? bars.length - 1) - Math.max(c.cut, c.range?.from ?? c.cut) + 1);
    let cells = topInRange(pool, v0, v1, cap);
    // Pool đã đầy mà vùng nhìn hẹp (zoom sâu) chỉ có ít ô trong pool: các ô nhỏ hơn ô bé nhất của pool bị cắt, nên hỏi riêng vùng này; chờ kết quả thì vẫn hiện phần lấy từ pool
    if (cells.length < cap && pool.length >= BIG_POOL) cells = c.ticks.big(v0, v1, min, cap, size) ?? cells;
    // thang cỡ: `count` ô lớn nhất của đoạn cuối chart (cỡ một màn hình mặc định, `count / BUBBLES_PER_BAR` nến), cố định khi zoom / kéo; lấy cả 14 ngày thì ngày dữ dội nhất ép mọi bubble ngày thường về cỡ nhỏ nhất
    const refFrom = Math.max(t0, bars[Math.max(c.cut, bars.length - Math.ceil(count / BUBBLES_PER_BAR))].t);
    return { ...empty, bubbles: bubblesOf(cells, bars.map((b) => b.t), step, c, topInRange(pool, refFrom, bars[bars.length - 1].t + step, count)) };
  },
};
