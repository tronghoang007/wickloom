import type { Bar, FpCell } from "@/lib/api";
import { finishProfile } from "@/volumeProfile/compute";
import { TICK_DEPTH } from "../lower";
import { num, str, type Ctx, type FootprintSet, type FpBar, type FpStyle, type FpType, type IndicatorDef, type InputDef, type ItemDef } from "../schema";
import { atr } from "../ta";
import { niceStep } from "./bigTrades";
import { barStep } from "./pivots";

// Volume footprint (kiểu TradingView "Volume footprint" + cách hiển thị của DeepCharts "Deep Print"): mỗi nến chia thành row giá, mỗi row có volume tick mua (lên) / bán (xuống)
// theo quy tắc tick như CVD. Tick của MT5 CFD không có khối lượng từng lệnh nên volume = số tick (mỗi tick tính 1), "mua / bán" là bên được đoán theo giá tick.
// Dữ liệu: backend /tickfp gom tick của các phút trong nến vào (nến, row); chart chỉ xin các cửa sổ 64 nến quanh vùng đang nhìn nên kéo chart không tạo yêu cầu mới liên tục.
// Chart chính ẩn nến của nó đi (Chart.tsx) và indicator tự vẽ nến mảnh giữa các ô như TV.

/** Số nến đệm hai bên vùng nhìn: kéo chart vài nến không để lộ chỗ trống chờ tính lại (250ms). */
const PAD = 40;
/** Mỗi cửa sổ xin tick dài chừng này nến (theo giờ, khoá cache ổn định khi kéo chart). */
const WINDOW_BARS = 64;
/** Vùng nhìn rộng hơn chừng này nến thì chỉ vẽ nến (không xin tick): ô quá bé để đọc. */
const MAX_BARS = 150;
/** Trần số row của một nến: Ticks per row nhỏ trên khung lớn (BTC D1, 1 tick / row) cho hàng chục nghìn row, vừa không đọc được vừa nặng: row cao thêm cho vừa. */
export const MAX_FP_ROWS = 1000;

const TYPES: Record<string, FpType> = { "Bid x Ask": "bidask", Delta: "delta", Volume: "volume", "Delta + Volume": "deltavol" };

const INPUTS: InputDef[] = [
  { hideInLegend: true, key: "rowMode", label: "Row size", type: "select", default: "Auto", options: ["Auto", "Manual"], group: "Rows", tooltip: "Auto: 0.2 × ATR (median of the last 50 closed candles), rounded to a 1 / 2 / 5 step so rows do not change on every candle. Manual: Ticks per row." },
  { hideInLegend: true, key: "atrLen", label: "ATR length", type: "int", default: 14, min: 1, max: 200, group: "Rows", enabledIf: (i) => i.rowMode === "Auto" },
  { hideInLegend: true, key: "ticks", label: "Ticks per row", type: "int", default: 10, min: 1, max: 100000, group: "Rows", enabledIf: (i) => i.rowMode === "Manual" },
  { key: "type", label: "Type", type: "select", default: "Bid x Ask", options: Object.keys(TYPES), group: "Style", tooltip: "Bid x Ask: one column right of the candle with the sell and buy volume side by side on every level, like ATAS (imbalance colours the number). Delta / Volume: one number per level. Delta + Volume: two columns." },
  { hideInLegend: true, key: "mode", label: "Mode", type: "select", default: "Box", options: ["Profile", "Box"], group: "Style", tooltip: "Profile: cell width follows the volume. Box: all cells have the same width." },
  { hideInLegend: true, key: "color", label: "Color mode", type: "select", default: "Fading", options: ["Fading", "Fixed", "None"], group: "Style", tooltip: "Fading: cell background gets stronger with its volume. Fixed: one strength. None: no background." },
  { hideInLegend: true, key: "textSize", label: "Text size", type: "int", default: 14, min: 6, max: 24, group: "Style", tooltip: "Largest size of the numbers; they shrink to fit the height of a level." },
  { hideInLegend: true, key: "textFormat", label: "Text format", type: "select", default: "Auto", options: ["Auto", "Normal", "K"], group: "Style", tooltip: "Auto: 1.2K only when the full number does not fit. Normal: always the full number. K: thousands as 1.2K." },
  { hideInLegend: true, key: "summary", label: "Info box", type: "bool", default: true, group: "Style", tooltip: "Total volume and delta below each candle." },
  { hideInLegend: true, key: "imb", label: "Imbalance", type: "bool", default: true, group: "Imbalance", tooltip: "Buy volume at a level against sell volume one level below (and sell against buy one level above)." },
  { hideInLegend: true, key: "imbPct", label: "Imbalance %", type: "int", default: 300, min: 100, max: 10000, group: "Imbalance", enabledIf: (i) => !!i.imb, tooltip: "The bigger side must be at least this % of the smaller side." },
  { hideInLegend: true, key: "imbMin", label: "Minimum volume difference", type: "int", default: 1, min: 0, group: "Imbalance", enabledIf: (i) => !!i.imb },
  { hideInLegend: true, key: "imbZero", label: "Include zero", type: "bool", default: false, group: "Imbalance", enabledIf: (i) => !!i.imb, tooltip: "A level facing an empty level counts as an imbalance. Off by default: tick data puts each tick on one side only, so on small timeframes most of these are noise." },
  { hideInLegend: true, key: "stacked", label: "Stacked imbalance", type: "bool", default: true, group: "Imbalance", enabledIf: (i) => !!i.imb },
  { hideInLegend: true, key: "stackN", label: "Stacked levels", type: "int", default: 3, min: 2, max: 20, group: "Imbalance", enabledIf: (i) => !!i.imb && !!i.stacked },
  { hideInLegend: true, key: "poc", label: "POC", type: "bool", default: true, group: "Point of control / Value area" },
  { hideInLegend: true, key: "va", label: "Value area", type: "bool", default: true, group: "Point of control / Value area" },
  { hideInLegend: true, key: "vaPct", label: "Value area volume (%)", type: "int", default: 70, min: 1, max: 100, group: "Point of control / Value area", enabledIf: (i) => !!i.va },
];

const ITEMS: ItemDef[] = [
  { id: "up", title: "Candle up", color: "#089981", group: "Candle", plain: true },
  { id: "down", title: "Candle down", color: "#f23645", group: "Candle", plain: true },
  { id: "buy", title: "Buy", color: "#26a69a", group: "Cells", plain: true },
  { id: "sell", title: "Sell", color: "#f23645", group: "Cells", plain: true },
  { id: "text", title: "Text", color: "#d1d4dc", group: "Cells", plain: true },
  { id: "imbBuy", title: "Buy imbalance", color: "#00e676", group: "Imbalance", plain: true },
  { id: "imbSell", title: "Sell imbalance", color: "#ff5252", group: "Imbalance", plain: true },
  { id: "poc", title: "POC", color: "#ffb300", group: "Lines", plain: true },
  { id: "va", title: "Value area", color: "#2962ff", group: "Lines", plain: true },
];

/** Auto: lấy trung vị của chừng này ATR gần nhất (không kể nến đang chạy) để row không nhảy nấc khi ATR chạm ngưỡng làm tròn. */
const AUTO_WINDOW = 50;

/** Cao (giá) của một row: Manual = số tick user đặt, Auto = 0.2 × ATR làm tròn nấc 1 / 2 / 5 (không nhỏ hơn 1 tick).
 *  ATR của nến đang chạy đổi theo từng tick và đổi row size làm mọi nến regroup + tải lại, nên Auto bỏ nến cuối và lấy trung vị `AUTO_WINDOW` ATR gần nhất. */
export function fpRowSize(bars: Bar[], tick: number, inputs: Ctx["inputs"]): number {
  let range = 0;
  for (const b of bars) range = Math.max(range, b.h - b.l);
  const floor = Math.ceil(range / MAX_FP_ROWS / tick - 1e-9); // số tick mỗi row tối thiểu để nến cao nhất không quá MAX_FP_ROWS row
  if (str(inputs, "rowMode") === "Manual") return Math.max(1, floor, Math.round(num(inputs, "ticks"))) * tick;
  const a = atr(bars, num(inputs, "atrLen"));
  const valid = (xs: number[]) => xs.filter((v) => !Number.isNaN(v));
  const done = valid(a.slice(0, -1)).slice(-AUTO_WINDOW);
  const recent = done.length > 0 ? done : valid(a).slice(-1); // chỉ có một nến: dùng luôn nó
  const med = recent.length > 0 ? [...recent].sort((x, y) => x - y)[recent.length >> 1] : NaN;
  const ticks = Number.isFinite(med) && med > 0 ? niceStep((0.2 * med) / tick) : 1;
  return Math.max(1, floor, Math.round(ticks)) * tick;
}

export type ImbalanceOpts = { enabled: boolean; pct: number; minDiff: number; zero: boolean; stacked: boolean; stackN: number };

/** Một bên (volume `big`) so với bên đối diện (`small`) có imbalance không: big >= pct% × small, chênh >= minDiff; đối diện = 0 thì tuỳ `zero`. */
export function isImbalance(big: number, small: number, o: ImbalanceOpts): boolean {
  if (!(big > 0) || big - small < o.minDiff) return false;
  return small === 0 ? o.zero : big >= (o.pct / 100) * small;
}

/** Đánh dấu các row thuộc chuỗi >= `n` row liên tiếp có cờ true. */
export function stackedRuns(flags: boolean[], n: number): boolean[] {
  const out = flags.map(() => false);
  let i = 0;
  while (i < flags.length) {
    if (!flags[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < flags.length && flags[j + 1]) j++;
    if (j - i + 1 >= n) for (let k = i; k <= j; k++) out[k] = true;
    i = j + 1;
  }
  return out;
}

/** Footprint của nến `b` (chỉ số `x`) từ các ô `cells` = [row, volume lên, volume xuống] (row phủ [row*size, (row+1)*size)): row liên tục từ thấp nhất tới cao nhất có tick,
 *  POC + Value Area (`va` % tổng volume, như volume profile) và imbalance chéo: mua ở row i so với bán ở row i-1, bán ở row i so với mua ở row i+1. */
export function fpBar(x: number, b: Bar, cells: [number, number, number][], size: number, va: number, imb: ImbalanceOpts): FpBar {
  const bar: FpBar = { x, o: b.o, h: b.h, l: b.l, c: b.c, size, rows: [], poc: -1, vl: -1, vh: -1, buyImb: [], sellImb: [], stackBuy: [], stackSell: [] };
  if (cells.length === 0) return bar;
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const [row] of cells) {
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
  }
  const N = maxRow - minRow + 1;
  const up = new Array<number>(N).fill(0);
  const dn = new Array<number>(N).fill(0);
  for (const [row, u, d] of cells) {
    up[row - minRow] += u;
    dn[row - minRow] += d;
  }
  bar.rows = up.map((u, i) => ({ p: (minRow + i) * size, up: u, dn: dn[i] }));
  const prof = finishProfile({ lo: minRow * size, hi: (maxRow + 1) * size, size, N }, up, dn, va);
  if (prof) {
    bar.poc = prof.poc;
    bar.vl = prof.vl;
    bar.vh = prof.vh;
  }
  const buy = up.map((u, i) => imb.enabled && i > 0 && isImbalance(u, dn[i - 1], imb));
  const sell = dn.map((d, i) => imb.enabled && i < N - 1 && isImbalance(d, up[i + 1], imb));
  bar.buyImb = buy;
  bar.sellImb = sell;
  bar.stackBuy = imb.stacked ? stackedRuns(buy, imb.stackN) : buy.map(() => false);
  bar.stackSell = imb.stacked ? stackedRuns(sell, imb.stackN) : sell.map(() => false);
  return bar;
}

/** Số hiển thị trong ô: Normal luôn đủ số, K luôn gọn (1.2K từ 1000), Auto đủ số nếu `fits` (hàm đo "vừa ô không") không thì gọn. */
export function fpText(v: number, format: FpStyle["textFormat"], fits: (s: string) => boolean = () => true): string {
  const full = String(Math.round(v));
  const k = Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}K` : full;
  return format === "normal" ? full : format === "k" ? k : fits(full) ? full : k;
}

/** Chữ của một ô kiểu "Bid x Ask": [sell, buy] (renderer đặt hai số quanh tâm ô và tô màu từng số). Auto: đủ số nếu `fits(sell, buy)` (đo cả hai số) không thì gọn (1.2K). */
export function fpPair(dn: number, up: number, format: FpStyle["textFormat"], fits: (sell: string, buy: string) => boolean = () => true): [string, string] {
  const full: [string, string] = [fpText(dn, "normal"), fpText(up, "normal")];
  const short: [string, string] = [fpText(dn, "k"), fpText(up, "k")];
  return format === "normal" ? full : format === "k" ? short : fits(...full) ? full : short;
}

function styleOf(c: Ctx): FpStyle {
  const { inputs, items } = c;
  return {
    type: TYPES[str(inputs, "type")] ?? "bidask",
    mode: str(inputs, "mode") === "Box" ? "box" : "profile",
    color: ({ Fading: "fading", Fixed: "fixed", None: "none" } as const)[str(inputs, "color") as "Fading" | "Fixed" | "None"] ?? "fading",
    textSize: num(inputs, "textSize"),
    textFormat: ({ Normal: "normal", K: "k" } as const)[str(inputs, "textFormat") as "Normal" | "K"] ?? "auto",
    summary: !!inputs.summary,
    imbalance: !!inputs.imb,
    stacked: !!inputs.imb && !!inputs.stacked,
    poc: !!inputs.poc,
    va: !!inputs.va,
    up: items.up.color, down: items.down.color, buy: items.buy.color, sell: items.sell.color, text: items.text.color,
    imbBuy: items.imbBuy.color, imbSell: items.imbSell.color, pocColor: items.poc.color, vaColor: items.va.color,
  };
}

/** Chỉ số nến đầu tiên có t >= `t` trong `times` tăng dần. */
function lowerBound(times: Bar[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const footprint: IndicatorDef = {
  id: "footprint", name: "Footprint", title: "Volume footprint", overlay: true,
  inputs: INPUTS,
  plots: [],
  items: ITEMS,
  needsRange: true,
  warmup: (inputs) => num(inputs, "atrLen") + 1,
  compute: () => ({}),
  ticks: (_inputs, { bars, step, range }) => {
    if (!range || bars.length === 0) return null;
    const i0 = Math.max(0, range.from - PAD);
    return { from: Math.max(bars[i0].t, bars[bars.length - 1].t + step - TICK_DEPTH) };
  },
  footprints: (c): FootprintSet => {
    const { bars, inputs } = c;
    const style = styleOf(c);
    if (bars.length === 0 || !c.range) return { bars: [], style };
    const i0 = Math.max(c.cut, c.range.from - PAD);
    const i1 = Math.min(bars.length - 1, c.range.to + PAD);
    const step = barStep(bars);
    const size = fpRowSize(bars, c.tick, inputs);
    const imb: ImbalanceOpts = {
      enabled: !!inputs.imb, pct: num(inputs, "imbPct"), minDiff: num(inputs, "imbMin"), zero: !!inputs.imbZero, stacked: !!inputs.stacked, stackN: num(inputs, "stackN"),
    };
    const va = inputs.va ? num(inputs, "vaPct") : 100;
    const rowsOn = !!c.ticks?.fp && c.range.to - c.range.from + 1 <= MAX_BARS; // theo vùng nhìn (zoom), không tính phần đệm: ở mép phải không có đệm phải
    const W = step * WINDOW_BARS;
    const out: FpBar[] = [];
    let i = i0;
    while (i <= i1) {
      const win = Math.floor(bars[i].t / W);
      const j0 = lowerBound(bars, win * W);
      let j1 = i;
      while (j1 + 1 < bars.length && Math.floor(bars[j1 + 1].t / W) === win) j1++;
      // cửa sổ = mọi nến của khoảng giờ [win*W, (win+1)*W): khoá cache theo cửa sổ, không theo phần đang nhìn
      let byBar: [number, number, number][][] | null = null;
      if (rowsOn && c.ticks!.covered(bars[Math.max(i0, j0)].t)) {
        const starts = bars.slice(j0, j1 + 1).map((b) => b.t);
        const cells: FpCell[] | null = c.ticks!.fp!(starts, bars[j1].t + step, size);
        if (cells) {
          byBar = starts.map(() => []);
          for (const [k, row, u, d] of cells) byBar[k]?.push([row, u, d]);
        }
      }
      for (let k = Math.max(i0, j0); k <= Math.min(i1, j1); k++) out.push(fpBar(k, bars[k], byBar ? byBar[k - j0] : [], size, va, imb));
      i = j1 + 1;
    }
    return { bars: out, style };
  },
};
