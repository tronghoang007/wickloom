import type { Deal, Mt5Account, PendingOrder, Position, TradeData } from "@/lib/mt5Api";
import type { TradeResult } from "@/lib/tradeApi";
import { checkStopMove, isPendingType, resolveOrderType, sideOfType, tooClose, type PendingType, type Side } from "./orderType";
import { estimatePnl, mt5Pnl, type PnlSpec } from "./pnl";
import { SIM_ACCOUNT_ID } from "./simId";

// Sàn giả lập của Replay: nhận lệnh như EA (market, lệnh chờ Limit / Stop, đóng / đóng một phần, sửa SL / TP / giá) và trả dữ liệu đúng khuôn MT5 (TradeData) nên toàn bộ giao diện
// giao dịch thật (bảng đặt lệnh, thẻ trên chart, panel Trading) chạy y nguyên trong Replay. Giá: nến replay là giá Bid, Ask = Bid + spread cố định của symbol (lấy từ giá thật lúc vào
// Replay). Khớp như MT5: Buy vào ở Ask / đóng ở Bid, Sell ngược lại; Buy limit / Buy stop / SL & TP của Sell xét theo Ask, còn lại theo Bid. Đường giá trong một nến đi theo mô hình OHLC
// của Strategy Tester (mở → thấp → cao → đóng nếu nến tăng, mở → cao → thấp → đóng nếu nến giảm), nên lệnh chờ khớp rồi chạm SL / TP trong cùng một nến cũng đúng thứ tự. Đi liền thì khớp
// đúng mức; nhảy giá (từ giá trước tới giá mở của nến mới) thì khớp ở giá mở như sàn thật (Stop trượt, Limit được giá tốt hơn). Hàm thuần, không đụng store.

/** Thông số của symbol mà sàn cần: lãi/lỗi theo tiền account (null = chưa biết, không nhận lệnh), số chữ số, stops level, lot tối thiểu / step (thiếu = không kiểm, như EA cũ).
 *  `exact` = symbol tính bằng chính tiền account (`exactPnlSpec`): lãi / lỗ làm tròn từng vế đúng như MT5 (`mt5Pnl`). */
export type SimSymbol = { spec: PnlSpec | null; exact?: PnlSpec | null; digits: number; stopsLevel: number | null; lot?: { min: number; step: number } | null };
export type SimEnv = (symbol: string) => SimSymbol;

export type SimBar = { t: number; o: number; h: number; l: number; c: number };
export type SimQuote = { bid: number; ask: number };
/** Việc sàn tự làm (không do người dùng bấm): lệnh chờ khớp / hết hạn / bị từ chối, SL / TP chạm, stop out. Giao diện báo bằng toast rồi xoá. */
export type SimEvent = { kind: "fill" | "sl" | "tp" | "so" | "expire" | "nomoney"; ticket: number; symbol: string; side: Side; volume: number; price: number; pnl: number; label: string };

export type SimAccountInfo = { currency: string; leverage: number | null; hedging: boolean; maxLot?: number; name: string; server: string; broker: string };

export type SimBook = {
  info: SimAccountInfo;
  balance: number;
  positions: Position[];
  orders: PendingOrder[];
  deals: Deal[];
  quotes: Record<string, SimQuote>;
  spreads: Record<string, number>; // Ask - Bid theo giá, cố định cho mỗi symbol
  time: number; // giờ replay hiện tại (epoch giây)
  nextOrder: number;
  nextDeal: number;
  events: SimEvent[];
};

const EPS = 1e-9;
const round = (v: number, d = 8) => Math.round(v * 10 ** d) / 10 ** d;
const DEFAULT_LEVERAGE = 100;

export function newBook(info: SimAccountInfo, balance: number, time = 0): SimBook {
  const deposit: Deal = { ticket: 1, order: 0, symbol: "", type: "balance", entry: "", volume: 0, price: 0, profit: balance, commission: 0, swap: 0, time, magic: 0, comment: "Replay deposit", position: 0 };
  return { info, balance, positions: [], orders: [], deals: [deposit], quotes: {}, spreads: {}, time, nextOrder: 1001, nextDeal: 2, events: [] };
}

const done = (r: Partial<TradeResult>): TradeResult => ({ ok: true, message: "", retcode: 10009, order: 0, deal: 0, price: 0, volume: 0, orderType: "", typeChanged: false, ...r });
const fail = (retcode: number, message: string): TradeResult => ({ ok: false, message, retcode, order: 0, deal: 0, price: 0, volume: 0, orderType: "", typeChanged: false });
export type SimOut = { book: SimBook; result: TradeResult };

/** Lãi / lỗ của `volume` lot mở ở `open`, đóng ở `close`, theo cent: như MT5 khi biết `exact`, còn lại theo tick value (làm tròn hiệu). */
function pnlOf(side: Side, volume: number, open: number, close: number, sym: SimSymbol): number {
  if (sym.exact) return mt5Pnl(side, volume, open, close, sym.exact);
  return sym.spec ? round(estimatePnl(side, volume, open, close, sym.spec), 2) : 0;
}

const openAt = (side: Side, q: SimQuote) => (side === "buy" ? q.ask : q.bid);
const closeAt = (side: Side, q: SimQuote) => (side === "buy" ? q.bid : q.ask);
const sideOf = (p: Position): Side => (p.type === "sell" ? "sell" : "buy");
const opposite = (s: Side): Side => (s === "buy" ? "sell" : "buy");

/** Giá trị danh nghĩa theo tiền account (`price × giá trị một đơn vị giá`), chia đòn bẩy = margin. Dùng tick value nên đúng cho cả cặp chéo / vàng / chỉ số. */
const marginOf = (volume: number, price: number, spec: PnlSpec | null, leverage: number | null) =>
  spec ? (volume * price * (spec.tickValue / spec.tickSize)) / (leverage && leverage > 0 ? leverage : DEFAULT_LEVERAGE) : 0;

/** Phần Buy / Sell khoá nhau của cùng symbol (hedging) tính bằng tỉ lệ này của margin hai chân. 0 theo các nguồn (không chính thức) nói Exness không lấy margin cho vị thế khoá đủ
 *  khối lượng; CHƯA xác minh, EA cũng chưa báo SYMBOL_MARGIN_HEDGED của từng symbol. Mặc định MT5 là 0.5 nếu cần đổi. */
export const HEDGED_MARGIN_RATE = 0;

type Leg = { side: Side; volume: number; price: number };

/** Margin các vị thế của một symbol: phần lệch giữa tổng Buy và tổng Sell tính đủ (giá vào trung bình của phía lớn hơn), phần khoá nhau theo HEDGED_MARGIN_RATE.
 *  Netting chỉ có một vị thế mỗi symbol nên là margin của chính nó. */
function symbolMargin(legs: Leg[], spec: PnlSpec | null, leverage: number | null): number {
  const sum = (s: Side) => legs.filter((l) => l.side === s).reduce((a, l) => ({ v: a.v + l.volume, pv: a.pv + l.volume * l.price }), { v: 0, pv: 0 });
  const buy = sum("buy");
  const sell = sum("sell");
  const [big, small] = buy.v >= sell.v ? [buy, sell] : [sell, buy];
  if (big.v <= EPS) return 0;
  const net = marginOf(big.v - small.v, big.pv / big.v, spec, leverage);
  if (small.v <= EPS || HEDGED_MARGIN_RATE === 0) return net;
  return net + HEDGED_MARGIN_RATE * (marginOf(small.v, big.pv / big.v, spec, leverage) + marginOf(small.v, small.pv / small.v, spec, leverage));
}

/** Tính lại giá hiện tại + lãi/lỗi của các vị thế theo giá đang có. */
function revalue(b: SimBook, env: SimEnv): SimBook {
  return {
    ...b,
    positions: b.positions.map((p) => {
      const q = b.quotes[p.symbol];
      if (!q) return p;
      const side = sideOf(p);
      const now = closeAt(side, q);
      return { ...p, price_current: now, profit: pnlOf(side, p.volume, p.price_open, now, env(p.symbol)) };
    }),
  };
}

export function equityOf(b: SimBook): number {
  return b.balance + b.positions.reduce((s, p) => s + p.profit + p.swap, 0);
}
/** Margin đang dùng; `extra` = thêm một lệnh giả định (kiểm đủ tiền trước khi vào lệnh). */
export function marginUsed(b: SimBook, env: SimEnv, extra?: Leg & { symbol: string }): number {
  const by = new Map<string, Leg[]>();
  const add = (symbol: string, l: Leg) => by.set(symbol, [...(by.get(symbol) ?? []), l]);
  for (const p of b.positions) add(p.symbol, { side: sideOf(p), volume: p.volume, price: p.price_open });
  if (extra) add(extra.symbol, extra);
  let m = 0;
  for (const [symbol, legs] of by) m += symbolMargin(legs, env(symbol).spec, b.info.leverage);
  return m;
}

/** Dữ liệu đúng khuôn GET /accounts/{id}/trade để giao diện thật đọc. `nowSec` = giờ thật (để không bị coi là dữ liệu cũ). */
export function snapshot(b: SimBook, env: SimEnv, nowSec: number): TradeData {
  const equity = equityOf(b);
  const margin = marginUsed(b, env);
  const account: Mt5Account = {
    id: SIM_ACCOUNT_ID, server: b.info.server, broker: b.info.broker, login: null, name: b.info.name, mode: "replay", currency: b.info.currency, leverage: b.info.leverage,
    balance: round(b.balance, 2), equity: round(equity, 2), margin: round(margin, 2), margin_free: round(equity - margin, 2), margin_level: margin > 0 ? round((equity / margin) * 100, 2) : 0,
    profit: round(equity - b.balance, 2), margin_mode: b.info.hedging ? "hedging" : "netting", trade_allowed: true, terminal_trade_allowed: true, ea_trading: true, max_lot: b.info.maxLot,
    online: true, active: true, seen: nowSec,
  };
  return { account, positions: b.positions, orders: b.orders, deals: b.deals, updated_at: nowSec };
}

/** Giá của symbol (nến replay) mà không xét lệnh: lúc vào Replay / đổi timeframe. Symbol chưa có spread thì giữ `spread` cho nó (0 = chưa biết, lần sau còn nhận spread khác). */
export function seed(b: SimBook, symbol: string, bid: number, time: number, spread: number, env: SimEnv): SimBook {
  const sp = (b.spreads[symbol] ?? 0) > 0 ? b.spreads[symbol] : Math.max(0, spread);
  const book = { ...b, time, spreads: { ...b.spreads, [symbol]: sp }, quotes: { ...b.quotes, [symbol]: { bid, ask: round(bid + sp) } } };
  if (book.deals[0]?.type === "balance" && book.deals[0].time === 0) book.deals = [{ ...book.deals[0], time }, ...book.deals.slice(1)];
  return revalue(book, env);
}

/** Symbol chưa biết spread (vào Replay lúc chưa có giá thật: cuối tuần, trang vừa mở) mà giờ đã biết: dùng từ đây. Đã có spread thì giữ nguyên (cố định trong phiên). */
export function fillSpread(b: SimBook, symbol: string, spread: number, env: SimEnv): SimBook {
  if ((b.spreads[symbol] ?? 0) > 0 || !(spread > 0)) return b;
  const book = { ...b, spreads: { ...b.spreads, [symbol]: spread } };
  const q = book.quotes[symbol];
  return q ? revalue(setQuote(book, symbol, q.bid), env) : book;
}

// --- khớp / đóng ---

/** Đóng `volume` của vị thế ở `price`: deal "out" (lãi/lỗi vào balance), vị thế giảm hoặc mất. */
function closePart(b: SimBook, p: Position, volume: number, price: number, reason: string, time: number, env: SimEnv, order = 0): { book: SimBook; deal: number; pnl: number } {
  const side = sideOf(p);
  const vol = Math.min(volume, p.volume);
  const pnl = pnlOf(side, vol, p.price_open, price, env(p.symbol));
  const deal: Deal = {
    ticket: b.nextDeal, order: order || b.nextOrder, symbol: p.symbol, type: opposite(side), entry: "out", volume: vol, price, profit: pnl, commission: 0, swap: 0, time, magic: 0, comment: "",
    position: p.ticket, sl: p.sl, tp: p.tp, reason,
  };
  const left = round(p.volume - vol);
  return {
    book: {
      ...b,
      balance: round(b.balance + pnl, 2),
      deals: [...b.deals, deal],
      nextDeal: b.nextDeal + 1,
      nextOrder: order ? b.nextOrder : b.nextOrder + 1,
      positions: left > EPS ? b.positions.map((x) => (x.ticket === p.ticket ? { ...x, volume: left } : x)) : b.positions.filter((x) => x.ticket !== p.ticket),
    },
    deal: deal.ticket,
    pnl,
  };
}

/** Một lệnh (market hoặc lệnh chờ vừa khớp) vào thị trường ở `price`. Hedging: luôn là vị thế mới (ticket = ticket lệnh). Netting: cộng dồn vị thế cùng hướng (giá vào trung bình),
 *  ngược hướng thì đóng bớt / hết, dư thì thành vị thế mới theo hướng lệnh. SL / TP của lệnh (khác 0) gắn vào vị thế. */
function fill(b: SimBook, o: { symbol: string; side: Side; volume: number; price: number; sl: number; tp: number; order: number; reason: string; time: number }, env: SimEnv): { book: SimBook; deal: number } {
  const mkIn = (book: SimBook, volume: number, ticket: number): { book: SimBook; deal: number } => {
    const deal: Deal = {
      ticket: book.nextDeal, order: o.order, symbol: o.symbol, type: o.side, entry: "in", volume, price: o.price, profit: 0, commission: 0, swap: 0, time: o.time, magic: 0, comment: "",
      position: ticket, sl: o.sl, tp: o.tp, reason: o.reason,
    };
    return { book: { ...book, deals: [...book.deals, deal], nextDeal: book.nextDeal + 1 }, deal: deal.ticket };
  };
  const pos: Position = { ticket: o.order, symbol: o.symbol, type: o.side, volume: o.volume, price_open: o.price, sl: o.sl, tp: o.tp, price_current: o.price, profit: 0, swap: 0, time: o.time, magic: 0, comment: "" };
  const net = b.info.hedging ? undefined : b.positions.find((p) => p.symbol === o.symbol);
  if (!net) {
    const r = mkIn(b, o.volume, o.order);
    return { book: revalue({ ...r.book, positions: [...r.book.positions, pos] }, env), deal: r.deal };
  }
  if (sideOf(net) === o.side) {
    const total = round(net.volume + o.volume);
    const merged: Position = { ...net, volume: total, price_open: (net.price_open * net.volume + o.price * o.volume) / total, sl: o.sl > 0 ? o.sl : net.sl, tp: o.tp > 0 ? o.tp : net.tp };
    const r = mkIn(b, o.volume, net.ticket);
    return { book: revalue({ ...r.book, positions: r.book.positions.map((x) => (x.ticket === net.ticket ? merged : x)) }, env), deal: r.deal };
  }
  const c = closePart(b, net, o.volume, o.price, o.reason, o.time, env, o.order);
  const rest = round(o.volume - net.volume);
  if (rest <= EPS) return { book: revalue(c.book, env), deal: c.deal };
  const r = mkIn(c.book, rest, o.order);
  return { book: revalue({ ...r.book, positions: [...r.book.positions, { ...pos, volume: rest }] }, env), deal: r.deal };
}

/** Đủ tiền cho thêm `volume` lot `side` ở `price` không (free margin sau lệnh ≥ 0). Lệnh không làm tăng margin (netting đóng bớt, hedging khoá vị thế) thì luôn được. */
function enoughMoney(b: SimBook, symbol: string, side: Side, volume: number, price: number, env: SimEnv): boolean {
  const after = marginUsed(b, env, { symbol, side, volume, price });
  if (after <= marginUsed(b, env) + EPS) return true;
  return equityOf(b) - after >= -EPS;
}

// --- lệnh của người dùng (cùng các trường hợp sàn từ chối như EA báo) ---

function stopsError(side: Side, target: "position" | "order", entry: number, sl: number, tp: number, q: SimQuote, s: SimSymbol): string | null {
  for (const [kind, price] of [["sl", sl], ["tp", tp]] as const) {
    if (!(price > 0)) continue;
    const why = checkStopMove({ target, side, kind, price, entry, bid: q.bid, ask: q.ask, digits: s.digits, stopsLevel: s.stopsLevel });
    if (why) return why;
  }
  return null;
}

function ready(b: SimBook, symbol: string, env: SimEnv): { q: SimQuote; s: SimSymbol } | TradeResult {
  const q = b.quotes[symbol];
  if (!q) return fail(10021, `Chưa có giá replay của ${symbol}`);
  const s = env(symbol);
  if (!s.spec) return fail(10013, `Chưa biết giá trị một tick của ${symbol} (cần EA ≥ 2.14) nên không tính được lãi/lỗi giả lập`);
  return { q, s };
}

export function marketOrder(b: SimBook, r: { symbol: string; side: Side; volume: number; sl?: number; tp?: number }, env: SimEnv): SimOut {
  const ok = ready(b, r.symbol, env);
  if ("ok" in ok) return { book: b, result: ok };
  if (!(r.volume > 0)) return { book: b, result: fail(10014, "Khối lượng không hợp lệ") };
  const sl = r.sl ?? 0;
  const tp = r.tp ?? 0;
  const why = stopsError(r.side, "position", 0, sl, tp, ok.q, ok.s);
  if (why) return { book: b, result: fail(10016, why) };
  const price = openAt(r.side, ok.q);
  if (!enoughMoney(b, r.symbol, r.side, r.volume, price, env)) return { book: b, result: fail(10019, "Không đủ tiền (free margin) cho lệnh này") };
  const order = b.nextOrder;
  const f = fill({ ...b, nextOrder: order + 1 }, { symbol: r.symbol, side: r.side, volume: r.volume, price, sl, tp, order, reason: "web", time: b.time }, env);
  return { book: f.book, result: done({ order, deal: f.deal, price, volume: r.volume }) };
}

export function pendingOrder(b: SimBook, r: { symbol: string; side: Side; volume: number; price: number; sl?: number; tp?: number; expiration?: number; expectedType?: PendingType | null }, env: SimEnv): SimOut {
  const ok = ready(b, r.symbol, env);
  if ("ok" in ok) return { book: b, result: ok };
  if (!(r.volume > 0)) return { book: b, result: fail(10014, "Khối lượng không hợp lệ") };
  const type = resolveOrderType(r.side, r.price, ok.q.bid, ok.q.ask);
  if (!type) return { book: b, result: fail(10015, "Giá vào trùng giá thị trường: lệnh chờ không đặt được ở đó") };
  if (tooClose(type, r.price, ok.q.bid, ok.q.ask, ok.s.stopsLevel, ok.s.digits)) return { book: b, result: fail(10015, `Quá gần giá thị trường (tối thiểu ${ok.s.stopsLevel} điểm)`) };
  const sl = r.sl ?? 0;
  const tp = r.tp ?? 0;
  const why = stopsError(r.side, "order", r.price, sl, tp, ok.q, ok.s);
  if (why) return { book: b, result: fail(10016, why) };
  const expiration = r.expiration ?? 0;
  if (expiration > 0 && expiration <= b.time) return { book: b, result: fail(10022, "Thời điểm hết hạn đã qua (giờ replay)") };
  const order: PendingOrder = { ticket: b.nextOrder, symbol: r.symbol, type, volume: r.volume, price_open: r.price, price_stoplimit: 0, sl, tp, time_setup: b.time, expiration, magic: 0, comment: "" };
  return {
    book: { ...b, orders: [...b.orders, order], nextOrder: b.nextOrder + 1 },
    result: done({ order: order.ticket, price: r.price, volume: r.volume, orderType: type, typeChanged: !!r.expectedType && r.expectedType !== type }),
  };
}

/** `volume` 0 = đóng hết. */
export function closePosition(b: SimBook, ticket: number, volume: number, env: SimEnv): SimOut {
  const p = b.positions.find((x) => x.ticket === ticket);
  if (!p) return { book: b, result: fail(10036, `Vị thế #${ticket} không còn`) };
  const q = b.quotes[p.symbol];
  if (!q) return { book: b, result: fail(10021, `Chưa có giá replay của ${p.symbol}`) };
  const vol = volume > 0 && volume < p.volume ? volume : p.volume;
  // như EA (HandlePositionClose): lot đóng phải ≥ lot tối thiểu và là bội của step
  const lot = env(p.symbol).lot;
  if (lot && lot.step > 0 && (vol < lot.min - EPS || Math.abs(vol / lot.step - Math.round(vol / lot.step)) > 1e-6)) return { book: b, result: fail(10014, "Khối lượng không hợp lệ (min/max/step của symbol)") };
  const price = closeAt(sideOf(p), q);
  const c = closePart(b, p, vol, price, "web", b.time, env);
  return { book: revalue(c.book, env), result: done({ deal: c.deal, price, volume: vol }) };
}

export function cancelOrder(b: SimBook, ticket: number): SimOut {
  if (!b.orders.some((x) => x.ticket === ticket)) return { book: b, result: fail(10036, `Lệnh chờ #${ticket} không còn`) };
  return { book: { ...b, orders: b.orders.filter((x) => x.ticket !== ticket) }, result: done({ order: ticket }) };
}

/** Trường nào có thì đổi (sl / tp = 0 là bỏ). MT5 không đổi loại lệnh chờ: giá mới làm loại khác đi thì từ chối (web tự đặt lệnh mới rồi xoá lệnh cũ). */
export function modifyOrder(b: SimBook, ticket: number, patch: { price?: number; sl?: number; tp?: number; expiration?: number }, env: SimEnv): SimOut {
  const o = b.orders.find((x) => x.ticket === ticket);
  if (!o || !isPendingType(o.type)) return { book: b, result: fail(10036, `Lệnh chờ #${ticket} không còn`) };
  const ok = ready(b, o.symbol, env);
  if ("ok" in ok) return { book: b, result: ok };
  const price = patch.price ?? o.price_open;
  const side = sideOfType(o.type);
  if (patch.price !== undefined) {
    if (resolveOrderType(side, price, ok.q.bid, ok.q.ask) !== o.type) return { book: b, result: fail(10015, "Giá mới làm đổi loại lệnh chờ") };
    if (tooClose(o.type, price, ok.q.bid, ok.q.ask, ok.s.stopsLevel, ok.s.digits)) return { book: b, result: fail(10015, `Quá gần giá thị trường (tối thiểu ${ok.s.stopsLevel} điểm)`) };
  }
  const sl = patch.sl ?? o.sl;
  const tp = patch.tp ?? o.tp;
  const why = stopsError(side, "order", price, sl, tp, ok.q, ok.s);
  if (why) return { book: b, result: fail(10016, why) };
  const next: PendingOrder = { ...o, price_open: price, sl, tp, expiration: patch.expiration ?? o.expiration };
  return { book: { ...b, orders: b.orders.map((x) => (x.ticket === ticket ? next : x)) }, result: done({ order: ticket, price }) };
}

export function modifyPosition(b: SimBook, ticket: number, patch: { sl?: number; tp?: number }, env: SimEnv): SimOut {
  const p = b.positions.find((x) => x.ticket === ticket);
  if (!p) return { book: b, result: fail(10036, `Vị thế #${ticket} không còn`) };
  const ok = ready(b, p.symbol, env);
  if ("ok" in ok) return { book: b, result: ok };
  const sl = patch.sl ?? p.sl;
  const tp = patch.tp ?? p.tp;
  // chỉ kiểm mức vừa đổi: mức cũ không đổi thì sàn không xét lại
  const why = stopsError(sideOf(p), "position", 0, patch.sl ?? 0, patch.tp ?? 0, ok.q, ok.s);
  if (why) return { book: b, result: fail(10016, why) };
  return { book: { ...b, positions: b.positions.map((x) => (x.ticket === ticket ? { ...x, sl, tp } : x)) }, result: done({ order: ticket }) };
}

/** Đóng hết vị thế + huỷ lệnh chờ của `symbol` (hoặc mọi symbol nếu bỏ trống) ở giá hiện tại: hết phiên Replay / chọn lại nến (thời gian nhảy, giữ vị thế là sai). */
export function closeAll(b: SimBook, env: SimEnv, symbol?: string): SimBook {
  let book: SimBook = { ...b, orders: b.orders.filter((o) => symbol !== undefined && o.symbol !== symbol) };
  for (const p of b.positions) {
    if (symbol !== undefined && p.symbol !== symbol) continue;
    const q = book.quotes[p.symbol];
    const cur = book.positions.find((x) => x.ticket === p.ticket);
    if (!q || !cur) continue;
    book = closePart(book, cur, cur.volume, closeAt(sideOf(cur), q), "client", book.time, env).book;
  }
  return revalue(book, env);
}

// --- giá chạy: lệnh chờ, SL / TP, stop out ---

type Trigger = { kind: "sl" | "tp" | "order"; ticket: number; level: number; bidLevel: number; up: boolean; rank: number };

/** Các mức chờ của `symbol` quy về giá Bid: mức xét theo Ask (Buy limit / Buy stop, SL / TP của Sell) trừ spread. `up` = khớp khi Bid lên tới mức. */
function triggers(b: SimBook, symbol: string): Trigger[] {
  const sp = b.spreads[symbol] ?? 0;
  const out: Trigger[] = [];
  for (const p of b.positions) {
    if (p.symbol !== symbol) continue;
    const buy = sideOf(p) === "buy";
    const shift = buy ? 0 : sp;
    if (p.sl > 0) out.push({ kind: "sl", ticket: p.ticket, level: p.sl, bidLevel: p.sl - shift, up: !buy, rank: 0 });
    if (p.tp > 0) out.push({ kind: "tp", ticket: p.ticket, level: p.tp, bidLevel: p.tp - shift, up: buy, rank: 1 });
  }
  for (const o of b.orders) {
    if (o.symbol !== symbol || !isPendingType(o.type)) continue;
    const buy = o.type.startsWith("buy");
    out.push({ kind: "order", ticket: o.ticket, level: o.price_open, bidLevel: o.price_open - (buy ? sp : 0), up: o.type === "buy_stop" || o.type === "sell_limit", rank: 2 });
  }
  return out;
}

function setQuote(b: SimBook, symbol: string, bid: number): SimBook {
  return { ...b, quotes: { ...b.quotes, [symbol]: { bid, ask: round(bid + (b.spreads[symbol] ?? 0)) } } };
}

/** Thực hiện một mức vừa chạm ở giá `price` (đúng mức, hoặc giá thị trường khi nhảy giá). */
function execute(b: SimBook, t: Trigger, price: number, time: number, env: SimEnv): SimBook {
  if (t.kind === "order") {
    const o = b.orders.find((x) => x.ticket === t.ticket);
    if (!o || !isPendingType(o.type)) return b;
    const side = sideOfType(o.type);
    const rest = revalue({ ...b, orders: b.orders.filter((x) => x.ticket !== o.ticket) }, env); // equity theo giá lúc khớp (giá vừa đổi chưa tính lại lãi/lỗi các vị thế)
    const ev = { ticket: o.ticket, symbol: o.symbol, side, volume: o.volume, price, pnl: 0 };
    if (!enoughMoney(rest, o.symbol, side, o.volume, price, env)) return { ...rest, events: [...rest.events, { ...ev, kind: "nomoney", label: o.type }] };
    const f = fill(rest, { symbol: o.symbol, side, volume: o.volume, price, sl: o.sl, tp: o.tp, order: o.ticket, reason: "web", time }, env);
    return { ...f.book, events: [...f.book.events, { ...ev, kind: "fill", label: o.type }] };
  }
  const p = b.positions.find((x) => x.ticket === t.ticket);
  if (!p) return b;
  const c = closePart(b, p, p.volume, price, t.kind, time, env);
  return { ...c.book, events: [...c.book.events, { kind: t.kind, ticket: p.ticket, symbol: p.symbol, side: sideOf(p), volume: p.volume, price, pnl: c.pnl, label: "" }] };
}

/** Equity ≤ 0 (stop out 0% như Exness; `force` = đã biết là chạm): đóng mọi vị thế ở giá hiện tại. Còn âm thì bù số dư về 0 (bảo vệ số dư âm), không thì account kẹt "không đủ tiền". */
function stopOut(b: SimBook, time: number, env: SimEnv, force = false): SimBook {
  if (b.positions.length === 0) return b;
  const v = revalue(b, env);
  if (!force && equityOf(v) > 0) return v;
  let book = v;
  for (const p of v.positions) {
    const q = book.quotes[p.symbol];
    if (!q) continue;
    const price = closeAt(sideOf(p), q);
    const c = closePart(book, p, p.volume, price, "so", time, env);
    book = { ...c.book, events: [...c.book.events, { kind: "so", ticket: p.ticket, symbol: p.symbol, side: sideOf(p), volume: p.volume, price, pnl: c.pnl, label: "" }] };
  }
  if (book.balance < 0) {
    const fix: Deal = { ticket: book.nextDeal, order: 0, symbol: "", type: "balance", entry: "", volume: 0, price: 0, profit: -book.balance, commission: 0, swap: 0, time, magic: 0, comment: "Negative balance protection", position: 0 };
    book = { ...book, balance: 0, deals: [...book.deals, fix], nextDeal: book.nextDeal + 1 };
  }
  return revalue(book, env);
}

/** Giá Bid trên đoạn `a` → `b` mà equity chạm 0, null nếu tới `b` equity vẫn dương. Lãi/lỗi đơn điệu theo giá nên chia đôi là đủ; làm tròn theo số chữ số về phía `b`. */
function stopOutLevel(bk: SimBook, symbol: string, a: number, b: number, env: SimEnv): number | null {
  if (!bk.positions.some((p) => p.symbol === symbol)) return null;
  const eq = (x: number) => equityOf(revalue(setQuote(bk, symbol, x), env));
  if (eq(b) > 0) return null;
  if (eq(a) <= 0) return a;
  let lo = a;
  let hi = b;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (eq(mid) > 0) lo = mid;
    else hi = mid;
  }
  const f = 10 ** env(symbol).digits;
  return b > a ? Math.min(b, Math.ceil(hi * f - 1e-6) / f) : Math.max(b, Math.floor(hi * f + 1e-6) / f);
}

/** Giá Bid đi thẳng từ `a` tới `b`. Mỗi vòng lấy mức gần `a` nhất mà đoạn này chạm, thực hiện, rồi đi tiếp từ mức đó (vị thế vừa khớp có SL / TP xa hơn trên đoạn vẫn được xét).
 *  Equity chạm 0 trước mức đó thì stop out ngay tại giá chạm (đoạn dài như cả nến H4 không làm lỗ vượt quá số dư).
 *  `gap` = nhảy giá: mọi mức nằm giữa khớp ở giá `b`. Mức đã bị vượt từ trước (giá đang ở bên kia) khớp ngay ở giá hiện tại. */
function walk(book: SimBook, symbol: string, a: number, b: number, gap: boolean, time: number, env: SimEnv): SimBook {
  let cur = a;
  let bk = book;
  for (let guard = 0; guard < 1000; guard++) {
    let best: Trigger | null = null;
    let bestD = Infinity;
    for (const t of triggers(bk, symbol)) {
      const past = t.up ? cur >= t.bidLevel : cur <= t.bidLevel;
      const reach = t.up ? b >= t.bidLevel : b <= t.bidLevel;
      if (!past && !reach) continue;
      const d = past ? 0 : Math.abs(t.bidLevel - cur);
      if (d < bestD - EPS || (Math.abs(d - bestD) <= EPS && best && t.rank < best.rank)) {
        best = t;
        bestD = d;
      }
    }
    const at = !best || gap ? b : bestD === 0 ? cur : best.bidLevel;
    const so = gap ? null : stopOutLevel(bk, symbol, cur, at, env); // nhảy giá: SL / TP khớp trước, stop out (nếu còn âm) xét ở cuối
    if (so !== null) {
      bk = stopOut(setQuote(bk, symbol, so), time, env, true);
      cur = so;
      continue;
    }
    if (!best) break;
    const beyond = bestD === 0 && Math.abs(cur - best.bidLevel) > EPS; // đã ở bên kia mức từ trước
    bk = setQuote(bk, symbol, at);
    const q = bk.quotes[symbol];
    // giá khớp: đúng mức khi giá đi liền tới đó, còn lại là giá thị trường theo phía của lệnh
    let price = best.level;
    if (gap || beyond) {
      if (best.kind === "order") {
        const o = bk.orders.find((x) => x.ticket === best.ticket);
        price = o && o.type.startsWith("buy") ? q.ask : q.bid;
      } else {
        const p = bk.positions.find((x) => x.ticket === best.ticket);
        price = p ? closeAt(sideOf(p), q) : best.level;
      }
    }
    bk = execute(bk, best, price, time, env);
    cur = at;
  }
  return stopOut(setQuote(bk, symbol, b), time, env);
}

/** Lệnh chờ tới giờ hết hạn (theo giờ replay): huỷ. */
function expire(b: SimBook, time: number): SimBook {
  const gone = b.orders.filter((o) => o.expiration > 0 && o.expiration <= time);
  if (gone.length === 0) return b;
  return {
    ...b,
    orders: b.orders.filter((o) => !gone.includes(o)),
    events: [...b.events, ...gone.map((o) => ({ kind: "expire" as const, ticket: o.ticket, symbol: o.symbol, side: (o.type.startsWith("buy") ? "buy" : "sell") as Side, volume: o.volume, price: o.price_open, pnl: 0, label: o.type }))],
  };
}

/** Bước replay: các nến (M1 khi Replay cập nhật theo phút, hoặc nến của chart) vừa chạy qua kể từ bước trước, rồi giờ replay mới `now`. Mỗi nến: nhảy từ giá trước tới giá mở, rồi
 *  mở → thấp → cao → đóng (nến tăng) hoặc mở → cao → thấp → đóng (nến giảm). */
export function feed(b: SimBook, symbol: string, bars: SimBar[], now: number, env: SimEnv): SimBook {
  let book = b;
  for (const bar of bars) {
    book = expire(book, bar.t); // hết hạn trước nến này thì không được khớp trong nến
    let prev = book.quotes[symbol]?.bid ?? bar.o;
    const path = bar.c >= bar.o ? [bar.l, bar.h, bar.c] : [bar.h, bar.l, bar.c];
    book = walk(book, symbol, prev, bar.o, true, bar.t, env);
    prev = bar.o;
    for (const p of path) {
      book = walk(book, symbol, prev, p, false, bar.t, env);
      prev = p;
    }
  }
  return revalue(expire({ ...book, time: Math.max(book.time, now) }, now), env);
}
