import type { Bar, TickCell, TickStat } from "@/lib/api";
import type { BigCells } from "../tickProfile";
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
    tooltip: "Smallest number of ticks at one price within one minute that gets a bubble: every cell at or above it is always shown, however far you zoom. 0 = automatic: the threshold is set by Sensitivity (sigma).",
  },
  {
    key: "sigma", label: "Sensitivity (sigma)", type: "float", default: 3.5, min: 0, max: 10, step: 0.1, group: "Filter",
    tooltip: "Automatic threshold = the mean + this many standard deviations of the volume of all cells (a minute at one price row) in the candles just before the right edge of the view, like the Pine 'Big Trades Whale Detector' (2 = significant, 4 = extreme). Lower shows more bubbles. Ignored when Minimum volume is set.",
    enabledIf: (i) => num(i, "min") === 0,
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

/** Số ô lớn nhất đọc về cho cả khoảng đã nạp (bằng giới hạn của /tickbig): bubble của vùng đang nhìn được chọn từ đây nên kéo / zoom không phải hỏi lại backend. */
export const BIG_POOL = 5000;

/** Trần số bubble hiện cùng lúc (zoom ra rất xa thì chỉ giữ các ô lớn nhất của vùng nhìn, để vẽ không nặng). */
export const MAX_SHOWN = 300;

/** Số nến của một khối cố định theo giờ (xem `refRange`). */
export const BLOCK_BARS = 100;

/** `count` ô lớn nhất (volume giảm dần, bằng nhau thì phút mới hơn trước) trong số các ô có phút nằm trong [from, to). */
export function topInRange(cells: TickCell[], from: number, to: number, count: number): TickCell[] {
  return cells.filter((k) => k.t >= from && k.t < to).sort((a, b) => b.up + b.dn - (a.up + a.dn) || b.t - a.t).slice(0, count);
}

/** Khoảng [từ, đến) quanh mép phải làm thang cỡ (`blocks` = 2) và thống kê của ngưỡng (`THR_BLOCKS`) của bubble: `blocks` khối `BLOCK_BARS` nến cố định theo giờ quanh mép phải `viewEnd` của vùng đang nhìn (khối chứa `viewEnd` và các khối trước nó, không quá `end` / `t0`).
 *  Zoom giữ mép phải thì khoảng này không đổi nên cỡ và ngưỡng không đổi; kéo về ngày vắng thì thang theo ngày đó (một thang chung cho cả 14 ngày làm ngày vắng toàn chấm nhỏ nhất với số thò ra ngoài, ngày dữ dội ép mọi bubble khác về nhỏ nhất). */
export function refRange(viewEnd: number, end: number, t0: number, step: number, blocks = 2): [number, number] {
  const block = refBlock(step);
  const k = Math.floor(viewEnd / block);
  return [Math.max(t0, (k + 1 - blocks) * block), Math.min(end, (k + 1) * block)];
}

/** Thống kê của ngưỡng lấy trên `THR_BLOCKS` khối (3 lần khoảng làm thang cỡ) để một đoạn thưa sát mép phải không kéo ngưỡng xuống rồi cả vùng nhìn rộng bị tràn bubble của các ngày sôi động hơn. */
export const THR_BLOCKS = 6;

/** Bề rộng (giây) của một khối cố định theo giờ của `refRange`; các lần hỏi riêng backend cũng bám khối này để kéo chart không đổi khoá hỏi ở mỗi bước. */
export const refBlock = (step: number): number => BLOCK_BARS * step;

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
 *  Cỡ và độ đậm tính theo `ref` (các ô lớn nhất quanh mép phải vùng nhìn, xem `refRange`; mặc định chính `cells`) chứ không theo riêng các ô đang nhìn, nên zoom không làm đổi cỡ một bubble. */
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

type BigMemo = { min?: number; pool?: TickCell[]; stat?: TickStat };

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
    const big = c.ticks.big;
    const end = bars[bars.length - 1].t + step;
    const block = refBlock(step);
    const last = Math.min(bars.length - 1, c.range?.to ?? bars.length - 1);
    const minIn = num(c.inputs, "min");
    const gotPool = big(t0, end, min, BIG_POOL, size);
    // Thống kê của ngưỡng hỏi cùng lúc với pool chứ không đợi pool về: hai lần nạp chạy song song nên khi row giá đổi (khoá mới cả hai) cả hai về gần như cùng lúc
    const statWin = (): [number, number] => {
      const [q0, q1] = refRange(bars[last].t, end, t0, step, THR_BLOCKS);
      return [q0, Math.ceil(q1 / block) * block];
    };
    const gotStat = minIn === 0 && bars[last] ? c.ticks.stat?.(...statWin(), size) : undefined;
    // Row giá đổi nấc (trung vị biên độ 200 nến cuối trôi qua ngưỡng làm tròn) là khoá mới của cả pool lẫn thống kê, chưa có gì để vẽ tới khi cả hai về. Trong lúc chờ vẽ tiếp bằng cặp (pool, thống kê)
    // hợp lệ gần nhất, luôn đi cùng nhau để ngưỡng khớp với các ô; chỉ dùng khi cùng ngưỡng Minimum volume. Cặp mới về đủ thì thay.
    const memo = c.memo as BigMemo | undefined;
    const ready = !!gotPool && (minIn !== 0 || !!gotStat);
    const kept = !ready && memo?.pool && memo.min === min && (minIn !== 0 || memo.stat) ? memo : undefined;
    const pool = ready ? gotPool : kept?.pool;
    const stat = ready ? gotStat : kept?.stat;
    if (!pool) return empty;
    if (ready && memo) Object.assign(memo, { min, pool, stat });
    const vol = (k: TickCell) => k.up + k.dn;
    // pool đầy (bị cắt ở BIG_POOL ô), hoặc bản mượn tạm đã lọc từ một pool đầy (`floor`): các ô nhỏ hơn mức đó có thể thiếu
    const poolMin = pool.length >= BIG_POOL ? pool.reduce((m, k) => Math.min(m, vol(k)), Infinity) : ((pool as BigCells).floor ?? 0);
    // `limit` ô lớn nhất của [from, to) có volume >= minVol. Pool đầy thì các ô nhỏ hơn ô bé nhất của pool bị cắt (M1 gặp thường xuyên: ngưỡng của vài giờ gần đây thấp hơn ô bé nhất của cả 14 ngày), nên nếu pool có thể thiếu ô của khoảng này thì hỏi riêng
    // khoảng đó, nới ra theo khối cố định để kéo / zoom nhẹ vẫn dùng lại kết quả; chờ kết quả thì vẫn dùng phần lấy từ pool (không nhấp nháy)
    const top = (from: number, to: number, minVol: number, limit: number): TickCell[] => {
      const got = topInRange(pool, from, to, limit).filter((k) => vol(k) >= minVol);
      const exact = poolMin === 0 || (got.length >= limit ? vol(got[limit - 1]) : minVol) > poolMin;
      if (exact || !ready) return got; // cặp cũ đang dùng tạm: không hỏi thêm theo row giá mới
      const ask = Math.min(BIG_POOL, limit * 4); // khoảng nới rộng: các ô lớn ở phần nới thêm không được chiếm hết chỗ của vùng nhìn
      const asked = big(Math.max(t0, Math.floor(from / block) * block), Math.min(end, Math.ceil(to / block) * block), minVol, ask, size);
      if (!asked) return got;
      const inView = topInRange(asked, from, to, limit);
      // đủ `limit` ô trong vùng (ô vùng nhìn không có trong kết quả đều nhỏ hơn) hoặc kết quả không bị cắt: đúng. Không thì hỏi đúng vùng nhìn
      if (inView.length >= limit || asked.length < ask) return inView;
      const own = big(from, to, minVol, limit, size);
      return own ? topInRange(own, from, to, limit) : inView;
    };
    const v0 = Math.max(t0, bars[Math.min(bars.length - 1, Math.max(c.cut, c.range?.from ?? c.cut))].t); // chưa biết vùng nhìn thì cả chart
    const v1 = bars[last].t + step;
    if (v1 <= v0) return empty;
    // Thang cỡ và ngưỡng tính trên các ô quanh mép phải vùng nhìn chứ không trên các ô đang hiện: zoom giữ mép phải thì cả cỡ lẫn tập bubble không đổi, zoom chỉ cắt bớt / thêm vào phần thấy được
    // Minimum volume > 0: ngưỡng cố định. Không thì ngưỡng = trung bình + sigma × độ lệch chuẩn volume của mọi ô trong khoảng dài hơn quanh mép phải (thống kê đủ từ backend, không tính phần bị cắt ở đầu tick / nến cuối để ngưỡng không trôi theo từng nến mới;
    // khoá hỏi theo khối nên không đổi khi kéo / zoom nhẹ). Chưa nạp xong thống kê thì chưa có bubble; khoảng đó không có ô nào thì chưa có ngưỡng, hiện mọi ô
    let thr = minIn;
    if (minIn === 0) {
      if (!stat) return empty;
      const sd = stat.n > 0 ? Math.sqrt(Math.max(0, stat.sumsq / stat.n - (stat.sum / stat.n) ** 2)) : 0;
      // volume của ô là số tick (nguyên): làm tròn lên không đổi tập ô >= ngưỡng, nhưng thống kê nạp lại mỗi phút chỉ nhích ngưỡng lẻ một chút thì khoá hỏi backend không đổi
      thr = stat.n > 0 ? Math.max(min, Math.ceil(stat.sum / stat.n + num(c.inputs, "sigma") * sd - 1e-9)) : min;
    }
    const cells = top(v0, v1, thr, MAX_SHOWN);
    // Cỡ và độ đậm tính trên các bubble (ô >= ngưỡng) quanh mép phải, không theo riêng các ô đang hiện
    const [r0, r1] = refRange(bars[last].t, end, t0, step);
    const ref = top(r0, r1, thr, MAX_SHOWN);
    return { ...empty, bubbles: bubblesOf(cells, bars.map((b) => b.t), step, c, ref) };
  },
};
