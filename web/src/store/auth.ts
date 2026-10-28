import { adoptGuestDrawings, guestDocs } from "@/drawings/guest";
import { setUnauthorizedHandler } from "@/lib/api";
import {
  AuthError,
  authLogin,
  authLogout,
  authMe,
  authRegister,
  authUpdateName,
  type User,
} from "@/lib/authApi";
import { create } from "zustand";
import { flushAllDrawings } from "./layout";
import { toast } from "./toast";

export type DialogState = { mode: "login" | "register"; reason?: string } | null;

type State = {
  /** loading = chưa biết (đang hỏi /auth/me, hoặc backend chưa chạy và đang thử lại) - UI không chớp nút Login. */
  status: "loading" | "guest" | "user";
  user: User | null;
  hint: string | null; // tên của lần đăng nhập trước, để vẽ avatar ngay trước khi /auth/me trả lời
  expired: boolean; // đang là user nhưng server trả 401 (hết phiên giữa lúc đang lưu)
  dialog: DialogState;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (b: { email: string; password: string; name?: string; claim_legacy?: boolean }) => Promise<void>;
  logout: () => Promise<void>;
  updateName: (name: string) => Promise<void>;
  openAuth: (mode: "login" | "register", reason?: string) => void;
  closeAuth: () => void;
  /** Điểm chặn duy nhất cho mọi thao tác cần tài khoản (Save, Buy/Sell…): true nếu đã/đã vừa đăng nhập, false nếu đóng popup. */
  requireLogin: (reason: string) => Promise<boolean>;
};

const HINT_KEY = "wickloom-auth-hint";
const EXPIRED_REASON = "Phiên đăng nhập hết hạn — đăng nhập lại để tiếp tục lưu";
const RETRY_MS = 4000;
const REPROMPT_MS = 60_000; // đóng popup hết phiên thì 60s sau mới hỏi lại

/** Gợi ý về lần đăng nhập trước (tên để vẽ avatar, id để mở layout đã cache khi backend chưa trả lời). */
export const readAuthHint = (): { name: string; id: string | null } | null => {
  try {
    const h = JSON.parse(localStorage.getItem(HINT_KEY) ?? "null");
    return h && typeof h.name === "string" ? { name: h.name, id: typeof h.id === "string" ? h.id : null } : null;
  } catch {
    return null;
  }
};
const readHint = (): string | null => readAuthHint()?.name ?? null;
const writeHint = (user: User | null) => {
  try {
    if (user) localStorage.setItem(HINT_KEY, JSON.stringify({ name: user.name, id: user.id }));
    else localStorage.removeItem(HINT_KEY);
  } catch {
    /* localStorage bị chặn: chỉ mất gợi ý avatar */
  }
};

type SessionHooks = {
  /** Vừa xác thực xong, TRƯỚC khi hình khách chuyển lên server: trả layout sẽ mở để hình đi vào đúng layout đó. */
  beforeLogin?: (user: User, fromGuest: boolean) => Promise<{ layoutId?: string } | void>;
  /** Trước khi xoá cookie: lưu nốt thứ còn chờ (ném lỗi để huỷ đăng xuất nếu chưa lưu được). */
  beforeLogout?: () => Promise<void>;
};
export const authHooks: SessionHooks = {};

let waiters: Array<(ok: boolean) => void> = [];
let refreshing: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let dismissedExpiredAt = 0;

const settle = (ok: boolean) => {
  const w = waiters;
  waiters = [];
  w.forEach((f) => f(ok));
};

export const useAuthStore = create<State>()((set, get) => {
  // Đã có phiên hợp lệ. Hình khách vẽ lúc chưa đăng nhập chuyển lên tài khoản TRƯỚC khi chart nạp lại từ server
  // (manager nghe đổi status/user): symbol nào server đã có hình thì server thắng.
  const enter = async (user: User, fromGuest: boolean) => {
    let adopted = 0;
    if (fromGuest) {
      try {
        await flushAllDrawings();
        const target = await authHooks.beforeLogin?.(user, true).catch(() => undefined);
        adopted = await adoptGuestDrawings(undefined, target?.layoutId);
      } catch {
        /* không chặn đăng nhập vì chuyển hình lỗi; hình còn trong bộ nhớ */
      }
    }
    writeHint(user);
    set({ status: "user", user, hint: user.name, expired: false, dialog: null });
    settle(true);
    return adopted;
  };

  return {
    status: "loading",
    user: null,
    hint: null,
    expired: false,
    dialog: null,

    refresh: () => {
      clearTimeout(retryTimer);
      set({ hint: readHint() });
      refreshing = (async () => {
        try {
          const user = await authMe();
          if (user) {
            writeHint(user);
            set({ status: "user", user, hint: user.name, expired: false });
          } else {
            writeHint(null);
            set({ status: "guest", user: null, hint: null });
          }
        } catch {
          // Backend chưa chạy: vẫn "loading" (không tự coi là khách), thử lại tới khi hỏi được.
          retryTimer = setTimeout(() => void get().refresh(), RETRY_MS);
        }
      })();
      return refreshing;
    },

    login: async (email, password) => {
      const { user } = await authLogin(email, password);
      const wasGuest = get().status !== "user";
      await enter(user, wasGuest);
      toast(`Đã đăng nhập: ${user.name}`);
    },

    register: async (b) => {
      const { user, claimed } = await authRegister(b);
      await enter(user, true);
      toast(`Đã đăng nhập: ${user.name}`);
      if (claimed > 0) toast(`Đã nhận ${claimed} mục dữ liệu cũ (watchlist, hình vẽ) vào tài khoản này`);
    },

    logout: async () => {
      // Lưu nốt hình vẽ khi còn cookie; cookie xoá trước thì PUT cuối cùng sẽ bị 401. Chưa lưu được thì huỷ đăng xuất (còn cookie để lưu lại).
      if (!(await flushAllDrawings())) throw new Error("hình vẽ chưa lưu được");
      await authHooks.beforeLogout?.(); // layout chưa lưu được thì huỷ đăng xuất (còn cookie để lưu lại)
      await authLogout(); // lỗi thì ném ra: vẫn đăng nhập, UI báo cho người dùng
      writeHint(null);
      guestDocs.clear();
      set({ status: "guest", user: null, hint: null, expired: false });
    },

    updateName: async (name) => {
      const { user } = await authUpdateName(name);
      writeHint(user);
      set({ user, hint: user.name });
    },

    openAuth: (mode, reason) => set({ dialog: { mode, reason } }),

    closeAuth: () => {
      if (get().expired) dismissedExpiredAt = Date.now();
      set({ dialog: null });
      settle(false);
    },

    requireLogin: async (reason) => {
      if (get().status === "loading" && refreshing) await refreshing;
      const s = get();
      if (s.status === "user" && !s.expired) return true;
      return new Promise<boolean>((resolve) => {
        waiters.push(resolve);
        if (!get().dialog) set({ dialog: { mode: "login", reason } });
      });
    },
  };
});

// Phiên hết hạn lúc đang lưu (PUT /me/* → 401): giữ nguyên dữ liệu trong bộ nhớ, mời đăng nhập lại; lần retry kế tiếp
// của DrawingSync sẽ lưu tiếp. Không lật sang "khách" (sẽ xoá hình chưa lưu).
setUnauthorizedHandler(() => {
  const s = useAuthStore.getState();
  if (s.status !== "user") return;
  useAuthStore.setState({ expired: true });
  if (!s.dialog && Date.now() - dismissedExpiredAt > REPROMPT_MS) {
    useAuthStore.setState({ dialog: { mode: "login", reason: EXPIRED_REASON } });
  }
});

export { AuthError };
