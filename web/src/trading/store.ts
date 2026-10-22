import { fetchTrade, type TradeData } from "@/lib/mt5Api";
import { useMt5Store } from "@/store/mt5";
import { create } from "zustand";

// Trạng thái giao dịch CHỈ ĐỌC của account MT5 đang cấp dữ liệu (docs/trade-plan.md T1). Hỏi GET /accounts/{id}/trade định kỳ.
export type TradeTab = "positions" | "orders" | "history" | "account";

type State = {
  data: TradeData | null;
  open: boolean; // panel dưới chart đang mở rộng
  tab: TradeTab;
  setOpen: (v: boolean) => void;
  showTab: (t: TradeTab) => void; // chọn tab và mở panel
  refresh: () => Promise<void>;
  clear: () => void;
};

export const useTradeStore = create<State>()((set) => ({
  data: null,
  open: false,
  tab: "positions",
  setOpen: (open) => set({ open }),
  showTab: (tab) => set({ tab, open: true }),
  refresh: async () => {
    const active = useMt5Store.getState().accounts.find((a) => a.active);
    if (!active) {
      set({ data: null });
      return;
    }
    const { data, unauthorized, gone } = await fetchTrade(active.id);
    if (data) set({ data });
    else if (unauthorized || gone) set({ data: null }); // hết phiên / account biến mất: không giữ vị thế cũ
    // lỗi mạng: giữ bản cũ (isStale() sẽ làm mờ khi quá 15s)
  },
  clear: () => set({ data: null }),
}));

export const TRADE_POLL_MS = 2000;

/** Hỏi ngay rồi mỗi TRADE_POLL_MS khi tab đang hiện. Trả về hàm dừng. */
export function startTradePolling(): () => void {
  void useTradeStore.getState().refresh();
  const t = setInterval(() => {
    if (typeof document === "undefined" || !document.hidden) void useTradeStore.getState().refresh();
  }, TRADE_POLL_MS);
  return () => clearInterval(t);
}
