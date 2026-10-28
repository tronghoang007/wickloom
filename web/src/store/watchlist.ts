import { getWatchlist, saveWatchlist } from "@/lib/api";
import { create } from "zustand";
import { useAuthStore } from "./auth";
import { toast } from "./toast";

// Watchlist của user đăng nhập (`/me/watchlist`, một document cả danh sách). Chưa đọc được bản trên server thì KHÔNG cho sửa:
// lưu đè từ danh sách rỗng (load lỗi / chưa xong) sẽ xoá watchlist thật. Mỗi lần lưu gắn với user đã sửa: đổi tài khoản trước khi
// kịp lưu thì bỏ (cookie lúc đó là của người khác).
export type WatchlistState = {
  uid: string | null;
  symbols: string[];
  status: "idle" | "loading" | "ready" | "error";
};

export const useWatchlistStore = create<WatchlistState>()(() => ({ uid: null, symbols: [], status: "idle" }));

const SAVE_DELAY = 500;
const RETRY_MS = 5000;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const clearTimers = () => {
  if (saveTimer) clearTimeout(saveTimer);
  if (retryTimer) clearTimeout(retryTimer);
  saveTimer = retryTimer = null;
};

/** Nạp watchlist của user `uid` (mở panel / đổi user). Lỗi thì thử lại sau RETRY_MS (tới khi `stopWatchlistRetry`).
 *  Đang có thay đổi chờ lưu của chính user này: bản trên máy mới hơn, không nạp đè. */
export function loadWatchlist(uid: string): Promise<void> {
  const set = useWatchlistStore.setState;
  const st = useWatchlistStore.getState();
  if (st.uid === uid && saveTimer) return Promise.resolve();
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (st.uid !== uid) {
    clearTimers();
    set({ uid, symbols: [], status: "loading" });
  } else if (st.status !== "ready") set({ status: "loading" });
  return getWatchlist().then(
    (symbols) => {
      if (useWatchlistStore.getState().uid === uid && !saveTimer) set({ symbols, status: "ready" });
    },
    () => {
      const cur = useWatchlistStore.getState();
      if (cur.uid !== uid) return;
      if (cur.status !== "ready") set({ status: "error" }); // đã có bản đọc được trước đó thì giữ, vẫn sửa được
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (useWatchlistStore.getState().uid === uid) void loadWatchlist(uid);
      }, RETRY_MS);
    },
  );
}

/** Panel đóng: thôi thử nạp lại. */
export function stopWatchlistRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

/** Đăng xuất: bỏ danh sách của user vừa rời khỏi bộ nhớ. */
export function resetWatchlist() {
  clearTimers();
  useWatchlistStore.setState({ uid: null, symbols: [], status: "idle" });
}

/** Thay danh sách (thêm / bỏ symbol) rồi lưu sau SAVE_DELAY. false nếu chưa đọc được bản trên server (không cho sửa). */
export function editWatchlist(next: string[]): boolean {
  const { uid, status } = useWatchlistStore.getState();
  if (!uid || status !== "ready") return false;
  useWatchlistStore.setState({ symbols: next });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const a = useAuthStore.getState();
    if (a.status !== "user" || a.user?.id !== uid) return; // đã đổi tài khoản / đăng xuất
    saveWatchlist(next).catch(() => toast("Chưa lưu được watchlist — thử lại sau"));
  }, SAVE_DELAY);
  return true;
}
