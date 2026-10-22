import { chartGlobal } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { create } from "zustand";
import { estimatePnl, pnlSpec, type PnlSpec } from "./pnl";
import type { Side } from "./orderType";

// Giả lập vào lệnh trong Replay (như "Replay Trading" của TradingView): Sell / Buy theo giá của nến replay đang chạy, một vị thế gộp (netting) cho symbol đang xem, SL / TP giả lập tự chốt khi nến
// replay chạm mức, lãi/lỗi tính lại mỗi bước, Flatten đóng hết. Hoàn toàn trong bộ nhớ, KHÔNG gửi gì tới MT5; thoát Replay hoặc đổi symbol thì xoá. Hàm thuần ở trên, kho theo từng pane ở dưới.

export type SimPosition = { side: Side; lot: number; entry: number; time: number; sl: number; tp: number }; // sl / tp = 0: không đặt
/** Lần chốt tự động gần nhất (SL / TP): `id` tăng mỗi lần để giao diện biết có sự kiện mới (báo toast). */
export type SimEvent = { id: number; reason: "sl" | "tp"; price: number; pnl: number; time: number };
export type SimBar = { t: number; h: number; l: number; c: number };
export type SimState = {
  symbol: string; // symbol của vị thế / lịch sử giả lập (đổi symbol thì reset)
  position: SimPosition | null;
  realized: number; // lãi/lỗi đã chốt (tiền account)
  trades: number; // số lần đóng (một phần hoặc hết)
  price: number | null; // giá nến replay hiện tại (đóng cửa của nến đang chạy)
  time: number | null;
  bar: { t: number; h: number; l: number } | null; // nến đã thấy ở bước trước: để biết bước này nến mở rộng thêm khoảng giá nào
  lot: string; // ô lot trên thanh replay
  event: SimEvent | null;
};

export const emptySim = (symbol = "", lot = ""): SimState => ({ symbol, position: null, realized: 0, trades: 0, price: null, time: null, bar: null, lot, event: null });

const EPS = 1e-9;
const round = (v: number) => Math.round(v * 1e8) / 1e8;

/** Lãi/lỗi đang mở của vị thế tại `price`; null nếu chưa có giá hoặc không biết giá trị một tick của symbol. */
export function openPnl(s: SimState, spec: PnlSpec | null): number | null {
  const p = s.position;
  if (!p) return 0;
  if (s.price === null || !spec) return null;
  return estimatePnl(p.side, p.lot, p.entry, s.price, spec);
}

/** Chốt `lot` của vị thế ở `price` (mặc định giá hiện tại). Trả trạng thái mới (vị thế giảm / hết). */
function closeLot(s: SimState, lot: number, spec: PnlSpec, price = s.price): SimState {
  const p = s.position;
  if (!p || price === null || !(lot > 0)) return s;
  const closed = Math.min(lot, p.lot);
  const left = p.lot - closed;
  return {
    ...s,
    realized: s.realized + estimatePnl(p.side, closed, p.entry, price, spec),
    trades: s.trades + 1,
    position: left > EPS ? { ...p, lot: round(left) } : null,
  };
}

/** Đặt lệnh market `side` `lot` lot ở giá hiện tại (netting): cùng hướng thì cộng dồn (giá vào trung bình, giữ SL / TP); ngược hướng thì giảm / đóng vị thế, quá lot thì đảo chiều phần dư
 *  (SL / TP của vị thế cũ không mang sang). */
export function placeOrder(s: SimState, side: Side, lot: number, spec: PnlSpec): SimState {
  if (s.price === null || !(lot > 0) || s.time === null) return s;
  const p = s.position;
  if (!p) return { ...s, position: { side, lot, entry: s.price, time: s.time, sl: 0, tp: 0 } };
  if (p.side === side) {
    const total = p.lot + lot;
    return { ...s, position: { ...p, lot: round(total), entry: (p.entry * p.lot + s.price * lot) / total } };
  }
  const after = closeLot(s, lot, spec);
  const rest = lot - p.lot;
  return rest > EPS ? { ...after, position: { side, lot: round(rest), entry: s.price, time: s.time, sl: 0, tp: 0 } } : after;
}

/** Đóng hết vị thế (nút Flatten / dấu × trên thẻ). */
export const flatten = (s: SimState, spec: PnlSpec): SimState => (s.position ? closeLot(s, s.position.lot, spec) : s);

/** Vì sao chưa đặt được SL / TP ở `price` (null = được): SL của Buy và TP của Sell phải dưới giá hiện tại, TP của Buy và SL của Sell phải trên. 0 = bỏ mức. */
export function checkStop(s: SimState, kind: "sl" | "tp", price: number): string | null {
  const p = s.position;
  if (!p || s.price === null) return "Chưa có vị thế";
  if (price === 0) return null;
  if (!(price > 0)) return "Giá không hợp lệ";
  const above = kind === "tp" ? p.side === "buy" : p.side === "sell"; // mức này phải nằm trên giá hiện tại
  if (above ? price <= s.price : price >= s.price) return `${kind.toUpperCase()} của lệnh ${p.side === "buy" ? "Buy" : "Sell"} phải ${above ? "cao" : "thấp"} hơn giá hiện tại`;
  return null;
}

/** Đặt / sửa / bỏ (price 0) SL hoặc TP; mức không hợp lệ thì giữ nguyên trạng thái. */
export function setStop(s: SimState, kind: "sl" | "tp", price: number): SimState {
  if (checkStop(s, kind, price) !== null || !s.position) return s;
  return { ...s, position: { ...s.position, [kind]: price } };
}

/** Nến replay mới (mỗi bước): cập nhật giá và kiểm tra SL / TP. Khoảng giá đã đi qua kể từ bước trước = từ giá trước tới giá đóng cửa mới, cộng thêm phần nến vừa mở rộng (nến mới: cả [thấp, cao]
 *  của nến; cùng nến đang gom dở: chỉ phần cao / thấp mới). Một bước chạm cả SL lẫn TP thì tính SL trước (thận trọng). Chốt ở đúng mức SL / TP (không trượt giá). */
export function ingest(s: SimState, bar: SimBar, spec: PnlSpec | null): SimState {
  let hi = bar.c;
  let lo = bar.c;
  if (s.price !== null) {
    hi = Math.max(hi, s.price);
    lo = Math.min(lo, s.price);
  }
  if (!s.bar || s.bar.t !== bar.t) {
    hi = Math.max(hi, bar.h);
    lo = Math.min(lo, bar.l);
  } else {
    if (bar.h > s.bar.h) hi = Math.max(hi, bar.h);
    if (bar.l < s.bar.l) lo = Math.min(lo, bar.l);
  }
  const next: SimState = { ...s, price: bar.c, time: bar.t, bar: { t: bar.t, h: bar.h, l: bar.l } };
  const p = next.position;
  if (!p || !spec) return next;
  const buy = p.side === "buy";
  const slHit = p.sl > 0 && (buy ? lo <= p.sl : hi >= p.sl);
  const tpHit = p.tp > 0 && (buy ? hi >= p.tp : lo <= p.tp);
  const reason = slHit ? "sl" : tpHit ? "tp" : null;
  if (!reason) return next;
  const price = reason === "sl" ? p.sl : p.tp;
  const closed = closeLot(next, p.lot, spec, price);
  return { ...closed, event: { id: (s.event?.id ?? 0) + 1, reason, price, pnl: estimatePnl(p.side, p.lot, p.entry, price, spec), time: bar.t } };
}

type Store = {
  byPane: Record<string, SimState>;
  /** Nến replay mới (mỗi bước replay). Đổi symbol so với trạng thái đang giữ thì bắt đầu lại sạch. Tự kiểm tra SL / TP. */
  ingest: (paneId: string, symbol: string, bar: SimBar) => void;
  setLot: (paneId: string, lot: string) => void;
  order: (paneId: string, side: Side, lot: number, spec: PnlSpec) => void;
  flatten: (paneId: string, spec: PnlSpec) => void;
  /** Đặt / sửa / bỏ (0) SL hoặc TP; trả false nếu mức không hợp lệ (không đổi gì). */
  setStop: (paneId: string, kind: "sl" | "tp", price: number) => boolean;
  reset: (paneId: string) => void;
};

const patch = (byPane: Record<string, SimState>, id: string, f: (s: SimState) => SimState) => ({ byPane: { ...byPane, [id]: f(byPane[id] ?? emptySim()) } });

/** Giá trị một tick của symbol theo tiền account đang chọn (USD nếu chưa có account): để kiểm tra SL / TP không cần component truyền vào. */
const specOf = (symbol: string): PnlSpec | null =>
  pnlSpec(chartGlobal.getState().symbols.find((x) => x.name === symbol), useMt5Store.getState().accounts.find((a) => a.active)?.currency ?? "USD");

export const useReplaySim = create<Store>()((set, get) => ({
  byPane: {},
  ingest: (id, symbol, bar) =>
    set((st) =>
      patch(st.byPane, id, (s) => {
        const base = s.symbol && s.symbol !== symbol ? emptySim(symbol, s.lot) : { ...s, symbol };
        return ingest(base, bar, specOf(symbol));
      }),
    ),
  setLot: (id, lot) => set((st) => patch(st.byPane, id, (s) => ({ ...s, lot }))),
  order: (id, side, lot, spec) => set((st) => patch(st.byPane, id, (s) => placeOrder(s, side, lot, spec))),
  flatten: (id, spec) => set((st) => patch(st.byPane, id, (s) => flatten(s, spec))),
  setStop: (id, kind, price) => {
    const cur = get().byPane[id] ?? emptySim();
    if (checkStop(cur, kind, price) !== null) return false;
    set((st) => patch(st.byPane, id, (s) => setStop(s, kind, price)));
    return true;
  },
  reset: (id) =>
    set((st) => {
      if (!st.byPane[id]) return st;
      const { [id]: gone, ...rest } = st.byPane; // eslint-disable-line @typescript-eslint/no-unused-vars
      return { byPane: rest };
    }),
}));
