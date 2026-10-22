import { fetchMt5Accounts, type Mt5Account } from "@/lib/mt5Api";
import { create } from "zustand";

// Account MT5 đang/đã kết nối (GET /accounts, cần đăng nhập). Backend hiện chỉ có 1 nguồn nên thường có đúng 1 account;
// `switchable` báo backend có cho chuyển giữa các account không (docs/multi-account-plan.md Phase 1).
type State = {
  accounts: Mt5Account[];
  switchable: boolean;
  loaded: boolean; // đã hỏi backend ít nhất một lần thành công
  refresh: () => Promise<void>;
  clear: () => void;
};

export const useMt5Store = create<State>()((set) => ({
  accounts: [],
  switchable: false,
  loaded: false,
  refresh: async () => {
    const { list, unauthorized } = await fetchMt5Accounts();
    if (list) set({ accounts: list.accounts, switchable: list.switchable, loaded: true });
    else if (unauthorized) set({ accounts: [], switchable: false, loaded: false }); // hết phiên / đăng xuất: không giữ số dư
    // lỗi mạng: giữ danh sách cũ (backend khởi động lại thì lần poll sau tự hết lỗi)
  },
  clear: () => set({ accounts: [], switchable: false, loaded: false }),
}));

export const POLL_MS = 10_000;

/** Hỏi /accounts ngay rồi mỗi POLL_MS khi tab đang hiện. Trả về hàm dừng. */
export function startMt5Polling(): () => void {
  const store = useMt5Store.getState();
  void store.refresh();
  const t = setInterval(() => {
    if (typeof document === "undefined" || !document.hidden) void useMt5Store.getState().refresh();
  }, POLL_MS);
  return () => clearInterval(t);
}
