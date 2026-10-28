import { chartGlobal } from "@/store/chart";
import { useAuthStore } from "@/store/auth";
import { useMt5Store } from "@/store/mt5";
import { toast } from "@/store/toast";
import { placeMarket, placePending, useOrderState } from "./actions";
import { defaultStop, draftPrices, parseNum, parsePrice, type TicketMode } from "./draft";
import { draftError, type DraftEnv } from "./draftCheck";
import { lotSpec, normalizeLot, writeLot } from "./lot";
import { resolveOrderType, snapPrice, type Side } from "./orderType";
import { useQuoteStore } from "./quote";
import { simNow } from "./simStore";
import { tradeAccount } from "./store";
import { useTicketStore } from "./ticket";

// Hành động trên bản nháp lệnh (panel bên phải và thanh đặt lệnh trên chart dùng chung): đọc store lúc gọi nên gọi được từ bất kỳ đâu.
function env(symbol: string): DraftEnv {
  return {
    sym: chartGlobal.getState().symbols.find((s) => s.name === symbol),
    quote: useQuoteStore.getState().quotes[symbol],
    account: tradeAccount(),
    status: useAuthStore.getState().status,
    loaded: useMt5Store.getState().loaded,
    nowSec: simNow() ?? Date.now() / 1000, // Replay: hết hạn của lệnh chờ tính theo giờ replay
  };
}

/** Gợi ý giá vào cho lệnh chờ chưa có giá: một mức phía Limit (Buy dưới thị trường, Sell trên); chưa có giá thị trường thì để trống. */
function seedPendingPrice(symbol: string, side: Side): string {
  const e = env(symbol);
  const q = e.quote;
  const digits = e.sym?.digits ?? 5;
  const tick = e.sym?.tick_size || 10 ** -digits;
  return q ? defaultStop("sl", side, side === "buy" ? q.ask : q.bid, tick, digits, e.sym?.stops_level).toFixed(digits) : "";
}

/** Bắt đầu bản nháp mới từ bảng đang chờ (sau khi đặt xong). Lệnh chờ phải có sẵn giá vào gợi ý, nếu không bản nháp không có đường nào trên chart để kéo. */
export function startDraft(symbol: string, side: Side, mode: TicketMode, digits?: number): void {
  const seed = mode === "pending" ? Number(seedPendingPrice(symbol, side)) : NaN;
  useTicketStore.getState().open({ symbol, side, mode, digits, price: seed > 0 ? seed : undefined });
}

/** Gửi bản nháp: lỗi thì báo bằng toast và không gửi gì, thành công thì bản nháp bỏ đi nhưng bảng đặt lệnh (thanh bên phải) KHÔNG đóng: nó ở trạng thái chờ như TradingView (`useTicketStore.settle`) tới khi bấm Sell / Buy. Trả true nếu sàn đã nhận lệnh. */
export async function submitDraft(): Promise<boolean> {
  const d = useTicketStore.getState().draft;
  if (!d || useOrderState.getState().busy) return false;
  const e = env(d.symbol);
  const err = draftError(d, e);
  if (err) {
    toast(err, { ms: 6000 });
    return false;
  }
  const spec = lotSpec(e.sym, e.account?.max_lot);
  if (!spec) return false;
  const digits = e.sym?.digits ?? 5;
  const tick = e.sym?.tick_size || 10 ** -digits;
  const volume = normalizeLot(parseNum(d.lot), spec);
  if (e.account) writeLot(e.account.id, d.symbol, volume); // nhớ lot vừa dùng cho account × symbol
  const snap = (v: number) => (v > 0 ? snapPrice(v, tick, digits) : 0);
  const typed = draftPrices(d, e.quote); // cùng cách đọc với lúc kiểm tra (draftError)
  const sl = snap(typed.sl);
  const tp = snap(typed.tp);
  let ok: boolean;
  if (d.mode === "market") {
    ok = await placeMarket(d.side, d.symbol, volume, digits, { sl, tp });
  } else {
    const price = snapPrice(typed.price, tick, digits);
    const expiration = d.until && d.untilText ? Math.floor(new Date(d.untilText).getTime() / 1000) : 0;
    const expectedType = e.quote ? resolveOrderType(d.side, price, e.quote.bid, e.quote.ask) : null;
    ok = await placePending({ symbol: d.symbol, side: d.side, volume, price, sl, tp, expiration, expectedType }, digits);
  }
  if (ok && useTicketStore.getState().draft) useTicketStore.getState().settle({ side: d.side, mode: d.mode }); // người dùng đã đóng bảng trong lúc lệnh đang bay thì không mở lại
  return ok;
}

/** Chuyển giữa Market và lệnh chờ. Lần đầu sang lệnh chờ chưa có giá vào thì gợi ý một mức phía Limit (Buy dưới thị trường, Sell trên). */
export function setDraftMode(mode: TicketMode): void {
  const { draft, patch } = useTicketStore.getState();
  if (!draft || mode === draft.mode) return;
  const seed = draft.price || seedPendingPrice(draft.symbol, draft.side);
  patch({ mode, price: seed });
}

/** Thêm SL / TP cho bản nháp ở mức gợi ý (đo từ giá vào của lệnh chờ, hoặc từ giá ĐÓNG vị thế với market: Buy ở Bid, Sell ở Ask). */
export function seedDraftStop(kind: "sl" | "tp"): void {
  const { draft, patch } = useTicketStore.getState();
  if (!draft) return;
  const e = env(draft.symbol);
  const q = e.quote;
  const digits = e.sym?.digits ?? 5;
  const tick = e.sym?.tick_size || 10 ** -digits;
  const ref = draft.mode === "market" ? (q ? (draft.side === "buy" ? q.bid : q.ask) : 0) : parsePrice(draft.price, q ? (q.bid + q.ask) / 2 : undefined);
  if (!(ref > 0)) return;
  patch({ [kind]: defaultStop(kind, draft.side, ref, tick, digits, e.sym?.stops_level).toFixed(digits) });
}
