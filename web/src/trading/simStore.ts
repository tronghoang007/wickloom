import type { TradeOutcome } from "@/lib/tradeApi";
import { chartGlobal } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { useConfirmStore } from "@/store/confirm";
import { toast, useToastStore } from "@/store/toast";
import { create } from "zustand";
import { cancelAllEdits } from "./editBridge";
import { useTradeFocus } from "./focus";
import { fmtLot, fmtPnl, fmtPx } from "./format";
import { isPendingType, pendingLabel } from "./orderType";
import { pnlSpec } from "./pnl";
import { useQuoteStore } from "./quote";
import * as sim from "./sim";
import { useTradeStore } from "./store";
import { useTicketStore } from "./ticket";

// Sàn giả lập của Replay (khớp lệnh ở trading/sim.ts) gắn vào giao diện: vào Replay thì kho dữ liệu giao dịch (useTradeStore) và kho giá (useQuoteStore) chuyển sang sổ lệnh giả lập, lệnh
// gửi đi (trading/actions.ts) tới đây thay vì backend, nên mọi thứ của giao dịch thật dùng được y nguyên mà KHÔNG gì tới MT5. Sổ lệnh sống trong bộ nhớ của tab: thoát / vào lại Replay vẫn
// giữ số dư và lịch sử (tải lại trang thì mất, nút Reset làm lại từ đầu). Số dư, đòn bẩy, netting / hedging chép từ account MT5 đang chọn lúc tạo sổ (khách: 10,000 USD, 1:100, hedging).

const GUEST = { balance: 10_000, currency: "USD", leverage: 100, hedging: true };

type State = { on: boolean; book: sim.SimBook | null };
export const useSimStore = create<State>()(() => ({ on: false, book: null }));

const env: sim.SimEnv = (symbol) => {
  const s = chartGlobal.getState().symbols.find((x) => x.name === symbol);
  const ccy = useSimStore.getState().book?.info.currency ?? "USD";
  return { spec: pnlSpec(s, ccy), digits: s?.digits ?? 5, stopsLevel: s?.stops_level ?? null };
};

function freshBook(): sim.SimBook {
  const a = useMt5Store.getState().accounts.find((x) => x.active);
  const bal = a?.balance && a.balance > 0 ? a.balance : GUEST.balance;
  return sim.newBook(
    {
      currency: a?.currency || GUEST.currency,
      leverage: a?.leverage ?? GUEST.leverage,
      hedging: a ? a.margin_mode !== "netting" : GUEST.hedging,
      maxLot: a?.max_lot,
      name: "Replay trading",
      server: a?.server ? `Replay · ${a.server}` : "Replay",
      broker: a?.broker ?? "",
    },
    bal,
  );
}

const EVENT_TEXT: Record<sim.SimEvent["kind"], string> = { fill: "khớp", sl: "SL chạm", tp: "TP chạm", so: "Stop out", expire: "hết hạn", nomoney: "bị huỷ: không đủ tiền" };

/** Đẩy sổ lệnh ra giao diện + báo các việc sàn tự làm (lệnh chờ khớp, SL / TP chạm...). */
function publish(book: sim.SimBook) {
  const events = book.events;
  const b = events.length ? { ...book, events: [] } : book;
  useSimStore.setState({ book: b });
  if (!useSimStore.getState().on) return;
  useTradeStore.getState().setSim(sim.snapshot(b, env, Date.now() / 1000));
  useQuoteStore.getState().setSim(b.quotes);
  const ccy = b.info.currency;
  for (const e of events) {
    const digits = env(e.symbol).digits;
    const what = e.kind === "fill" || e.kind === "expire" || e.kind === "nomoney" ? (isPendingType(e.label) ? pendingLabel(e.label) : "Lệnh chờ") : e.side === "buy" ? "Buy" : "Sell";
    const pnl = e.kind === "sl" || e.kind === "tp" || e.kind === "so" ? ` · ${fmtPnl(e.pnl)} ${ccy}` : "";
    toast(`${what} ${fmtLot(e.volume)} ${e.symbol} #${e.ticket} ${EVENT_TEXT[e.kind]} @ ${fmtPx(e.price, digits)}${pnl}`, {
      ms: 6000,
      title: "Replay",
      kind: e.kind === "tp" || e.kind === "fill" ? "success" : e.kind === "sl" || e.kind === "so" || e.kind === "nomoney" ? "error" : "info",
    });
  }
}

const book = () => useSimStore.getState().book ?? freshBook();

/** Đổi giữa account thật và account giả lập: bản nháp, lệnh đang chọn, thay đổi chờ xác nhận, hộp thoại xác nhận đang mở và nút "Hoàn tác" của toast đều thuộc về bên cũ
 *  (ticket của bên này không phải của bên kia): bỏ hết để không gửi nhầm sang account kia. */
function dropUi() {
  cancelAllEdits();
  useConfirmStore.getState().close();
  useToastStore.setState((s) => ({ items: s.items.filter((t) => !t.action) }));
  useTradeFocus.getState().set(null);
  const t = useTicketStore.getState();
  if (t.draft || t.modifyOwner !== null || t.rest) t.close();
}

/** Vào Replay: giao diện giao dịch chuyển sang account giả lập. */
export function enterSim() {
  if (useSimStore.getState().on) return;
  dropUi();
  useSimStore.setState({ on: true });
  publish(book());
}

/** Thoát Replay: đóng vị thế / huỷ lệnh chờ ở giá replay cuối (giữ số dư + lịch sử), giao diện về account MT5. */
export function leaveSim() {
  if (!useSimStore.getState().on) return;
  const b = useSimStore.getState().book;
  if (b) useSimStore.setState({ book: { ...sim.closeAll(b, env), events: [] } });
  useSimStore.setState({ on: false });
  dropUi();
  useTradeStore.getState().setSim(null);
  useQuoteStore.getState().setSim(null);
}

/** Chọn lại nến bắt đầu (thời gian nhảy): đóng hết những gì đang mở ở giá cũ. */
export function restartSim() {
  const b = useSimStore.getState().book;
  if (b && (b.positions.length || b.orders.length)) publish({ ...sim.closeAll(b, env), events: [] });
}

/** Bắt đầu lại sổ lệnh từ số dư của account MT5 (nút Reset ở panel Trading). */
export function resetSim() {
  const old = useSimStore.getState().book;
  const b = freshBook();
  // giữ giá + spread đã có để vẫn đặt lệnh được ngay
  publish(old ? { ...b, quotes: old.quotes, spreads: old.spreads, time: old.time, deals: b.deals.map((d) => ({ ...d, time: old.time })) } : b);
}

/** Giá replay của `symbol` mà không xét lệnh (vào Replay, đổi timeframe). Spread lấy từ giá thật đang có của symbol, lần đầu thấy symbol. */
export function seedSim(symbol: string, bid: number, time: number) {
  if (!useSimStore.getState().on) return;
  const q = useQuoteStore.getState().real[symbol];
  publish(sim.seed(book(), symbol, bid, time, q ? q.ask - q.bid : 0, env));
}

/** Bước replay: các nến vừa chạy qua (xem `sim.feed`). */
export function feedSim(symbol: string, bars: sim.SimBar[], now: number) {
  if (!useSimStore.getState().on) return;
  const b = book();
  if (!b.quotes[symbol]) return seedSim(symbol, bars[bars.length - 1]?.c ?? 0, now);
  publish(sim.feed(b, symbol, bars, now, env));
}

/** Giờ replay hiện tại (epoch giây) khi đang Replay, null nếu không. */
export const simNow = (): number | null => (useSimStore.getState().on ? (useSimStore.getState().book?.time ?? null) : null);

// --- cùng chữ ký với lib/tradeApi.ts (accountId bỏ qua) để trading/actions.ts gửi lệnh tới đây khi account là account giả lập ---
const run = (f: (b: sim.SimBook) => sim.SimOut): Promise<TradeOutcome> => {
  const out = f(book());
  if (out.result.ok) publish(out.book);
  return Promise.resolve({ kind: "done", result: out.result });
};

export const simApi = {
  market: (_: string, o: { symbol: string; side: "buy" | "sell"; volume: number; sl?: number; tp?: number }) => run((b) => sim.marketOrder(b, o, env)),
  pending: (_: string, o: Parameters<typeof sim.pendingOrder>[1]) => run((b) => sim.pendingOrder(b, o, env)),
  close: (_: string, ticket: number, volume = 0) => run((b) => sim.closePosition(b, ticket, volume, env)),
  cancel: (_: string, ticket: number) => run((b) => sim.cancelOrder(b, ticket)),
  modifyOrder: (_: string, ticket: number, patch: { price?: number; sl?: number; tp?: number; expiration?: number }) => run((b) => sim.modifyOrder(b, ticket, patch, env)),
  modifyPosition: (_: string, ticket: number, patch: { sl?: number; tp?: number }) => run((b) => sim.modifyPosition(b, ticket, patch, env)),
};
