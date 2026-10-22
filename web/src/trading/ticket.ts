import { chartGlobal } from "@/store/chart";
import { useRailStore } from "@/store/rail";
import { useMt5Store } from "@/store/mt5";
import { create } from "zustand";
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
  id: number;
  open: (s: TicketSeed) => void;
  patch: (p: Partial<Draft>) => void;
  /** Đặt xong: bỏ bản nháp nhưng để bảng mở ở trạng thái chờ. */
  settle: (r: TicketRest) => void;
  close: () => void;
};

export const useTicketStore = create<State>()((set) => ({
  draft: null,
  rest: null,
  id: 0,
  open: (seed) => {
    const sym = chartGlobal.getState().symbols.find((s) => s.name === seed.symbol);
    const account = useMt5Store.getState().accounts.find((a) => a.active);
    const spec = lotSpec(sym, account?.max_lot);
    const digits = seed.digits ?? sym?.digits ?? 5;
    useRailStore.getState().openOrder(); // bảng đặt lệnh nằm ở thanh bên phải: mở thanh ra
    set((s) => ({
      id: s.id + 1,
      rest: null,
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
  settle: (rest) => set({ draft: null, rest }),
  close: () => {
    useRailStore.getState().closeOrder(); // trả thanh về panel trước đó, không đóng cả thanh
    set({ draft: null, rest: null });
  },
}));
