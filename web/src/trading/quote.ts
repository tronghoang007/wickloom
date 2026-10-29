import { create } from "zustand";

// Giá Bid/Ask mới nhất của từng symbol, lấy từ tick realtime mà Chart nhận qua WebSocket. Widget SELL/BUY đọc ở đây. Đang Replay thì `quotes` là giá của sàn giả lập (trading/simStore.ts):
// mọi chỗ đọc giá để đặt / kiểm lệnh tự dùng giá replay; giá thật vẫn được ghi vào `real` và trả lại khi thoát Replay.
type Quote = { bid: number; ask: number };
type State = {
  quotes: Record<string, Quote>;
  real: Record<string, Quote>;
  sim: boolean;
  set: (symbol: string, bid: number, ask: number) => void;
  /** Giá của sàn giả lập; null = về giá thật. */
  setSim: (quotes: Record<string, Quote> | null) => void;
};

// Lúc nhận tick gần nhất của từng symbol (giờ máy, ms), kể cả tick lặp giá: biết giá trong kho còn đang chạy hay đã cũ (chart rời symbol đó, không ai subscribe nữa).
const tickAt: Record<string, number> = {};
/** Giá thật của `symbol` có tick trong `maxAgeMs` gần đây không. */
export const quoteFresh = (symbol: string, maxAgeMs: number, nowMs = Date.now()) => nowMs - (tickAt[symbol] ?? -Infinity) <= maxAgeMs;

export const useQuoteStore = create<State>()((set, get) => ({
  quotes: {},
  real: {},
  sim: false,
  set: (symbol, bid, ask) => {
    if (!(bid > 0) || !(ask > 0)) return; // tick thiếu một phía (vd chỉ có last)
    tickAt[symbol] = Date.now();
    const cur = get().real[symbol];
    if (cur && cur.bid === bid && cur.ask === ask) return; // tick lặp: khỏi render lại
    const real = { ...get().real, [symbol]: { bid, ask } };
    set(get().sim ? { real } : { real, quotes: real });
    sampleSpread(symbol, Math.round((ask - bid) * 1e8) / 1e8);
  },
  setSim: (quotes) => set(quotes ? { sim: true, quotes } : { sim: false, quotes: get().real }),
}));

/** Giá cho chart đang hiện (`replay` = chart đó đang Replay): pane khác đang Replay thì chart thường vẫn thấy giá THẬT (kho `quotes` lúc đó là giá giả lập). */
export const quoteOf = (s: Pick<State, "quotes" | "real" | "sim">, symbol: string, replay: boolean): Quote | undefined => (s.sim && !replay ? s.real[symbol] : s.quotes[symbol]);

// Spread điển hình của từng symbol cho Replay (nến replay chỉ có Bid): trung vị các mẫu spread thật, mỗi 30 giây một mẫu, giữ 120 mẫu gần nhất (~1 giờ có tick), nhớ qua lần tải
// trang nên vào Replay lúc chưa có tick (cuối tuần, trang vừa mở) vẫn có spread. Không lấy tick cuối: spread giãn lúc đóng cửa / rollover.
const SPREAD_KEY = "wickloom-spreads";
const SAMPLE_MS = 30_000;
const MAX_SAMPLES = 120;
let samples: Record<string, number[]> | null = null;
const sampledAt: Record<string, number> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function loadSamples(): Record<string, number[]> {
  if (samples) return samples;
  try {
    const raw = JSON.parse(localStorage.getItem(SPREAD_KEY) ?? "{}");
    samples = raw && typeof raw === "object" ? raw : {};
  } catch {
    samples = {};
  }
  return samples as Record<string, number[]>;
}

function sampleSpread(symbol: string, spread: number) {
  const now = Date.now();
  if (!(spread > 0) || now - (sampledAt[symbol] ?? 0) < SAMPLE_MS) return;
  sampledAt[symbol] = now;
  const s = loadSamples();
  s[symbol] = [...(Array.isArray(s[symbol]) ? s[symbol] : []), spread].slice(-MAX_SAMPLES);
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(SPREAD_KEY, JSON.stringify(samples));
    } catch {
      // không lưu được (chế độ riêng tư...): chỉ mất phần nhớ qua lần tải trang
    }
  }, 5000);
}

/** Spread điển hình (trung vị) của `symbol`, null khi chưa từng thấy tick của nó. */
export function typicalSpread(symbol: string): number | null {
  const list = loadSamples()[symbol];
  const xs = (Array.isArray(list) ? list : []).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)] : null;
}

/** Spread theo pip như TradingView ("45.0"): symbol 3 / 5 chữ số có pipette nên 1 pip = 10 điểm (vàng 0.45 → 45.0, EURUSD 0.00012 → 1.2); còn lại tính theo điểm. */
export function spreadPips(bid: number, ask: number, digits: number): string {
  const pip = digits === 3 || digits === 5 ? 10 ** -(digits - 1) : 10 ** -digits;
  return Math.max(0, (ask - bid) / pip).toFixed(1);
}

/** Giá có dấu phẩy ngàn, tách chữ số cuối (pipette) ra riêng để vẽ nhỏ + nâng lên như TV: 4087.44 (3 chữ số) → ["4,087.44", "0"]. Symbol không có pipette thì phần sau rỗng. */
export function splitPrice(v: number, digits: number): [string, string] {
  const full = v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return digits === 3 || digits === 5 ? [full.slice(0, -1), full.slice(-1)] : [full, ""];
}
