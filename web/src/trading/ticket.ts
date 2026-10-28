import { chartGlobal } from "@/store/chart";
import { useRailStore } from "@/store/rail";
import { tradeAccount } from "./store";
import { create } from "zustand";
import { useTradeFocus } from "./focus";
import type { Draft, TicketMode } from "./draft";
import { currentLot, fmtLotValue, lotSpec } from "./lot";
import type { Side } from "./orderType";

// Bảng đặt lệnh (docs/trade-plan.md T3-T4): bấm SELL / BUY hoặc "Add order" ở menu chuột phải mở bảng này. `draft` là bản nháp đang soạn: bảng và các đường entry/SL/TP
// trên chart cùng đọc / ghi nó, nên kéo đường trên chart thì ô nhập đổi theo và ngược lại. `id` đổi mỗi lần mở để bảng dựng lại từ đầu.
export type TicketSeed = { symbol: string; side: Side; mode: TicketMode; price?: number; digits?: number };
/** Bảng đang mở nhưng chưa có bản nháp (như TradingView sau khi đặt xong): các ô mờ đi, bấm Sell / Buy hoặc "Start creating order" mới bắt đầu lệnh mới theo hướng / loại lệnh đã nhớ. */
export type TicketRest = { side: Side; mode: TicketMode };
type State = {
  draft: Draft | null;
  rest: TicketRest | null;
  /** Lệnh đã đặt đang được chọn trên chart ("position:<ticket>" | "order:<ticket>"): bảng hiện Modify / Delete / Discard của lệnh đó thay cho bản nháp. */
  modifyOwner: string | null;
  id: number;
  /** Bấm chọn (không kéo) một lệnh đã đặt trên chart: bỏ bản nháp đang soạn, mở thanh bên phải ở bảng của lệnh đó và focus nó trên chart. */
  select: (owner: string) => void;
  /** Kéo (không bấm) một lệnh đã đặt: thanh bên phải đang ở bảng đặt lệnh thì bảng đổi sang lệnh đang kéo; thanh đang đóng / ở panel khác thì không tự mở. */
  follow: (owner: string) => void;
  open: (s: TicketSeed) => void;
  patch: (p: Partial<Draft>) => void;
  /** Đặt xong: bỏ bản nháp nhưng để bảng mở ở trạng thái chờ. */
  settle: (r: TicketRest) => void;
  close: () => void;
  /** Bấm biểu tượng Order ở thanh bên phải khi bảng đang mở: bảng Modify (chỉ xem / sửa lệnh đã đặt) thì đóng hẳn như ×, gồm bỏ chọn lệnh trên chart; bản nháp thì chỉ ẩn bảng, giữ bản nháp để mở lại. */
  hide: () => void;
};

export const useTicketStore = create<State>()((set) => ({
  draft: null,
  rest: null,
  modifyOwner: null,
  id: 0,
  select: (owner) => {
    useRailStore.getState().openOrder();
    useTradeFocus.getState().set(owner);
    set((s) => ({ modifyOwner: owner, draft: null, rest: s.draft ? { side: s.draft.side, mode: s.draft.mode } : s.rest, id: s.id + 1 }));
  },
  follow: (owner) => {
    const s = useTicketStore.getState();
    if (useRailStore.getState().open !== "order" || (s.modifyOwner === owner && !s.draft)) return; // gọi mỗi lần di chuột: chỉ dựng lại bảng khi đổi lệnh
    useTicketStore.setState({ modifyOwner: owner, draft: null, rest: s.draft ? { side: s.draft.side, mode: s.draft.mode } : s.rest, id: s.id + 1 });
  },
  open: (seed) => {
    const sym = chartGlobal.getState().symbols.find((s) => s.name === seed.symbol);
    const account = tradeAccount();
    const spec = lotSpec(sym, account?.max_lot);
    const digits = seed.digits ?? sym?.digits ?? 5;
    useRailStore.getState().openOrder(); // bảng đặt lệnh nằm ở thanh bên phải: mở thanh ra
    useTradeFocus.getState().set("draft"); // focus bản nháp mới: các lệnh đã đặt mờ đi như khi chọn một lệnh khác; để nguyên focus cũ thì chính bản nháp bị mờ (nút kéo TP / SL gần như vô hình)
    set((s) => ({
      id: s.id + 1,
      rest: null,
      modifyOwner: null,
      draft: {
        symbol: seed.symbol,
        side: seed.side,
        mode: seed.mode,
        price: seed.price !== undefined ? seed.price.toFixed(digits) : "",
        sl: "",
        tp: "",
        lot: spec ? fmtLotValue(currentLot(account?.id, seed.symbol, spec), spec) : "",
        until: false,
        untilText: "",
      },
    }));
  },
  patch: (p) => set((s) => (s.draft ? { draft: { ...s.draft, ...p } } : s)),
  settle: (rest) => {
    if (useTradeFocus.getState().owner === "draft") useTradeFocus.getState().set(null); // bản nháp đã đặt xong: các lệnh còn lại hết mờ
    set({ draft: null, rest, modifyOwner: null });
  },
  close: () => {
    useTradeFocus.getState().set(null); // đóng bảng (×, Esc) cũng bỏ chọn lệnh trên chart: không để lệnh khác bị mờ mà không còn bảng nào
    useRailStore.getState().closeOrder(); // trả thanh về panel trước đó, không đóng cả thanh
    set({ draft: null, rest: null, modifyOwner: null });
  },
  hide: () => {
    if (useTicketStore.getState().modifyOwner !== null) useTicketStore.getState().close(); // chỉ ẩn bảng thì lệnh vẫn được chọn: các lệnh khác mờ và biểu tượng Order còn sáng dù không còn bảng nào
    useRailStore.getState().setOpen(null);
  },
}));

// Bấm nền chart / Esc / Discard bỏ focus thì bảng Modify cũng thôi, và trả thanh bên phải về panel trước đó: để thanh còn ở "order" (chỉ ẩn) thì cú kéo kế tiếp, `follow` thấy thanh đang
// mở bảng đặt lệnh nên dựng lại bảng như vừa bấm chọn (kéo lệnh khác chỉ đổi focus, không đổi bảng)
useTradeFocus.subscribe((f) => {
  if (f.owner !== null || useTicketStore.getState().modifyOwner === null) return;
  useTicketStore.setState({ modifyOwner: null });
  useRailStore.getState().closeOrder();
});
