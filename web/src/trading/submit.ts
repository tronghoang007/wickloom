import { chartGlobal } from "@/store/chart";
import { useAuthStore } from "@/store/auth";
import { useMt5Store } from "@/store/mt5";
import { toast } from "@/store/toast";
import { placeMarket, placePending, useOrderState } from "./actions";
import { defaultStop, parseNum, type TicketMode } from "./draft";
import { draftError, type DraftEnv } from "./draftCheck";
import { lotSpec, normalizeLot, writeLot } from "./lot";
import { resolveOrderType, snapPrice } from "./orderType";
import { useQuoteStore } from "./quote";
import { useTicketStore } from "./ticket";

// Hành động trên bản nháp lệnh (panel bên phải và thanh đặt lệnh trên chart dùng chung): đọc store lúc gọi nên gọi được từ bất kỳ đâu.
function env(symbol: string): DraftEnv {
  return {
    sym: chartGlobal.getState().symbols.find((s) => s.name === symbol),
    quote: useQuoteStore.getState().quotes[symbol],
    account: useMt5Store.getState().accounts.find((a) => a.active),
    status: useAuthStore.getState().status,
    loaded: useMt5Store.getState().loaded,
    nowSec: Date.now() / 1000,
  };
}

/** Gửi bản nháp: lỗi thì báo bằng toast và không gửi gì, thành công thì đóng bản nháp. Trả true nếu sàn đã nhận lệnh. */
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
  const sl = snap(parseNum(d.sl));
  const tp = snap(parseNum(d.tp));
  let ok: boolean;
  if (d.mode === "market") {
    ok = await placeMarket(d.side, d.symbol, volume, digits, { sl, tp });
  } else {
    const price = snapPrice(parseNum(d.price), tick, digits);
    const expiration = d.until && d.untilText ? Math.floor(new Date(d.untilText).getTime() / 1000) : 0;
    const expectedType = e.quote ? resolveOrderType(d.side, price, e.quote.bid, e.quote.ask) : null;
    ok = await placePending({ symbol: d.symbol, side: d.side, volume, price, sl, tp, expiration, expectedType }, digits);
  }
  if (ok) useTicketStore.getState().close();
  return ok;
}

/** Chuyển giữa Market và lệnh chờ. Lần đầu sang lệnh chờ chưa có giá vào thì gợi ý một mức phía Limit (Buy dưới thị trường, Sell trên). */
export function setDraftMode(mode: TicketMode): void {
  const { draft, patch } = useTicketStore.getState();
  if (!draft || mode === draft.mode) return;
  const e = env(draft.symbol);
  const digits = e.sym?.digits ?? 5;
  const tick = e.sym?.tick_size || 10 ** -digits;
  const q = e.quote;
  const seed = !draft.price && q ? defaultStop("sl", draft.side, draft.side === "buy" ? q.ask : q.bid, tick, digits, e.sym?.stops_level).toFixed(digits) : draft.price;
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
  const ref = draft.mode === "market" ? (q ? (draft.side === "buy" ? q.bid : q.ask) : 0) : parseNum(draft.price);
  if (!(ref > 0)) return;
  patch({ [kind]: defaultStop(kind, draft.side, ref, tick, digits, e.sym?.stops_level).toFixed(digits) });
}
