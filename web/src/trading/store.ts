import { fetchTrade, type Mt5Account, type TradeData } from "@/lib/mt5Api";
import { useMt5Store } from "@/store/mt5";
import { create } from "zustand";

// Trạng thái giao dịch CHỈ ĐỌC của account MT5 đang cấp dữ liệu (docs/trade-plan.md T1). Hỏi GET /accounts/{id}/trade định kỳ. Đang Replay thì `data` là dữ liệu của sàn giả lập
// (trading/simStore.ts, cùng khuôn) nên panel / chart / bảng đặt lệnh hiện lệnh giả lập; dữ liệu MT5 vẫn được hỏi vào `real` và trả lại khi thoát Replay.
export type TradeTab = "positions" | "orders" | "history";

type State = {
  data: TradeData | null;
  real: TradeData | null;
  sim: boolean;
  /** Dữ liệu của sàn giả lập; null = về dữ liệu MT5. */
  setSim: (d: TradeData | null) => void;
  open: boolean; // panel dưới chart đang mở rộng
  tab: TradeTab;
  setOpen: (v: boolean) => void;
  showTab: (t: TradeTab) => void; // chọn tab và mở panel
  refresh: () => Promise<void>;
  clear: () => void;
};

let asked = 0; // số thứ tự lần hỏi /trade gần nhất
let applied = 0; // số thứ tự của lần hỏi đã ghi vào store

export const useTradeStore = create<State>()((set, get) => ({
  data: null,
  real: null,
  sim: false,
  setSim: (d) => set(d ? { sim: true, data: d } : { sim: false, data: get().real }),
  open: false,
  tab: "positions",
  setOpen: (open) => set({ open }),
  showTab: (tab) => set({ tab, open: true }),
  refresh: async () => {
    const active = useMt5Store.getState().accounts.find((a) => a.active);
    const put = (real: TradeData | null) => set(get().sim ? { real } : { real, data: real });
    const seq = ++asked;
    if (!active) {
      applied = seq;
      put(null);
      return;
    }
    // vừa đổi account MT5: bỏ ngay vị thế của account cũ (bấm Close trên đó sẽ gửi ticket cũ tới account mới)
    if (get().real && get().real!.account.id !== active.id) put(null);
    const { data, unauthorized, gone } = await fetchTrade(active.id);
    // Nhiều lần hỏi chồng nhau (nhịp poll 2s + hỏi sớm sau khi đặt lệnh): trả lời về muộn của lần hỏi cũ hơn không được đè bản mới hơn (vị thế vừa đóng hiện lại),
    // và account đã đổi trong lúc chờ thì bỏ trả lời của account cũ
    const nowId = useMt5Store.getState().accounts.find((a) => a.active)?.id;
    if (nowId !== active.id) {
      if (get().real && get().real!.account.id !== nowId) put(null);
      return;
    }
    if (seq < applied) return;
    if (data) {
      applied = seq;
      put(data);
    } else if (unauthorized || gone) {
      applied = seq;
      put(null); // hết phiên / account biến mất: không giữ vị thế cũ
    }
    // lỗi mạng: giữ bản cũ (isStale() sẽ làm mờ khi quá 15s)
  },
  clear: () => set(get().sim ? { real: null } : { real: null, data: null }),
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

/** Account đang nhận lệnh: account giả lập khi đang Replay, còn lại account MT5 đang cấp dữ liệu. */
export const tradeAccount = (): Mt5Account | undefined => {
  const t = useTradeStore.getState();
  return t.sim ? t.data?.account : useMt5Store.getState().accounts.find((a) => a.active);
};

export function useTradeAccount(): Mt5Account | undefined {
  const sim = useTradeStore((s) => (s.sim ? s.data?.account : undefined));
  const real = useMt5Store((s) => s.accounts.find((a) => a.active));
  return sim ?? real;
}
