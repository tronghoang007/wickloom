import * as authApi from "@/lib/authApi";
import { apiFetch } from "@/lib/api";
import { getPane } from "@/store/layout";
import { guestDocs, memoryFetch } from "@/drawings/guest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "./auth";
import { useToastStore } from "./toast";

vi.mock("@/lib/authApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/authApi")>()),
  authMe: vi.fn(),
  authLogin: vi.fn(),
  authRegister: vi.fn(),
  authLogout: vi.fn(),
}));

const me = { id: "u1", email: "a@b.co", name: "Anh" };
const auth = () => useAuthStore.getState();
const fresh = () => useAuthStore.setState({ status: "loading", user: null, hint: null, expired: false, dialog: null });

beforeEach(() => {
  vi.useFakeTimers();
  fresh();
  guestDocs.clear();
  useToastStore.setState({ items: [] });
  vi.mocked(authApi.authMe).mockReset();
  vi.mocked(authApi.authLogin).mockReset();
  vi.mocked(authApi.authRegister).mockReset();
  vi.mocked(authApi.authLogout).mockReset();
});
afterEach(() => {
  auth().closeAuth();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("refresh", () => {
  it("có phiên → user; không → khách", async () => {
    vi.mocked(authApi.authMe).mockResolvedValueOnce(me);
    await auth().refresh();
    expect(auth()).toMatchObject({ status: "user", user: me });
    vi.mocked(authApi.authMe).mockResolvedValueOnce(null);
    await auth().refresh();
    expect(auth()).toMatchObject({ status: "guest", user: null });
  });

  it("backend chưa chạy → vẫn loading (không tự coi là khách) rồi thử lại tới khi hỏi được", async () => {
    vi.mocked(authApi.authMe).mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(me);
    await auth().refresh();
    expect(auth().status).toBe("loading");
    await vi.advanceTimersByTimeAsync(4000);
    expect(authApi.authMe).toHaveBeenCalledTimes(2);
    expect(auth().status).toBe("user");
  });
});

describe("requireLogin", () => {
  it("đã đăng nhập → true ngay, không mở popup", async () => {
    useAuthStore.setState({ status: "user", user: me });
    expect(await auth().requireLogin("Lưu layout")).toBe(true);
    expect(auth().dialog).toBeNull();
  });

  it("khách → mở popup kèm lý do; đăng nhập xong thì resolve true và đóng popup", async () => {
    useAuthStore.setState({ status: "guest" });
    vi.mocked(authApi.authLogin).mockResolvedValueOnce({ user: me });
    const p = auth().requireLogin("Đăng nhập để lưu layout");
    await Promise.resolve();
    expect(auth().dialog).toEqual({ mode: "login", reason: "Đăng nhập để lưu layout" });
    await auth().login("a@b.co", "pw-pw-pw-1");
    expect(await p).toBe(true);
    expect(auth()).toMatchObject({ status: "user", dialog: null });
  });

  it("đóng popup → false", async () => {
    useAuthStore.setState({ status: "guest" });
    const p = auth().requireLogin("x");
    await Promise.resolve();
    auth().closeAuth();
    expect(await p).toBe(false);
  });

  it("gọi chồng nhau dùng chung 1 popup và cùng kết quả", async () => {
    useAuthStore.setState({ status: "guest" });
    const a = auth().requireLogin("A");
    const b = auth().requireLogin("B");
    await Promise.resolve();
    expect(auth().dialog?.reason).toBe("A"); // popup đang mở không bị thay
    auth().closeAuth();
    expect(await Promise.all([a, b])).toEqual([false, false]);
  });

  it("đang loading thì đợi /auth/me rồi mới quyết định (user đã đăng nhập không bị hỏi lại)", async () => {
    vi.mocked(authApi.authMe).mockResolvedValueOnce(me);
    const refreshing = auth().refresh();
    const p = auth().requireLogin("x");
    await refreshing;
    expect(await p).toBe(true);
    expect(auth().dialog).toBeNull();
  });
});

describe("đăng nhập từ chế độ khách", () => {
  const putGuest = (sym: string) =>
    memoryFetch(`http://127.0.0.1:8000/me/drawings/${sym}__default`, { method: "PUT", body: JSON.stringify({ version: 1, items: [{ id: sym }] }) });

  it("hình khách chuyển lên server trước khi status đổi sang user (chart nạp lại thấy ngay)", async () => {
    const rows: Record<string, unknown> = {};
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
      const u = String(input);
      if (init?.method === "PUT") { rows[u] = JSON.parse(String(init.body)); return new Response("{}"); }
      return u in rows ? new Response(JSON.stringify({ data: rows[u] })) : new Response("", { status: 404 });
    }) as typeof fetch);
    useAuthStore.setState({ status: "guest" });
    await putGuest("XAU");
    vi.mocked(authApi.authLogin).mockResolvedValueOnce({ user: me });
    let seenAtSwitch: number | null = null;
    const unsub = useAuthStore.subscribe((s) => { if (s.status === "user") seenAtSwitch = Object.keys(rows).length; });
    await auth().login("a@b.co", "pw-pw-pw-1");
    unsub();
    expect(seenAtSwitch).toBe(1);
    expect(Object.keys(rows)).toEqual(["http://127.0.0.1:8000/me/drawings/XAU__default"]);
    expect(guestDocs.size()).toBe(0);
  });

  it("đăng ký: báo số mục dữ liệu cũ đã nhận", async () => {
    useAuthStore.setState({ status: "guest" });
    vi.mocked(authApi.authRegister).mockResolvedValueOnce({ user: me, claimed: 5 });
    await auth().register({ email: "a@b.co", password: "pw-pw-pw-1", claim_legacy: true });
    expect(useToastStore.getState().items.map((t) => t.text).join("|")).toMatch(/nhận 5 mục/);
  });

  it("sai mật khẩu: ném lỗi, vẫn là khách, popup còn mở", async () => {
    useAuthStore.setState({ status: "guest", dialog: { mode: "login" } });
    vi.mocked(authApi.authLogin).mockRejectedValueOnce(new authApi.AuthError("Email hoặc mật khẩu không đúng", 401));
    await expect(auth().login("a@b.co", "bad")).rejects.toThrow("Email hoặc mật khẩu không đúng");
    expect(auth()).toMatchObject({ status: "guest", dialog: { mode: "login" } });
  });
});

describe("logout", () => {
  it("lưu nốt hình vẽ TRƯỚC khi xoá cookie (PUT cuối không bị 401)", async () => {
    useAuthStore.setState({ status: "user", user: me });
    const order: string[] = [];
    getPane("p1").draw.setState({
      api: { flushSave: async () => { await Promise.resolve(); order.push("flush"); } } as never,
    });
    vi.mocked(authApi.authLogout).mockImplementation(async () => { order.push("logout"); return { ok: true }; });
    await auth().logout();
    expect(order).toEqual(["flush", "logout"]);
    getPane("p1").draw.setState({ api: null });
    expect(auth()).toMatchObject({ status: "guest", user: null });
  });

  it("backend không trả lời → vẫn đăng nhập (không giả vờ đã thoát)", async () => {
    useAuthStore.setState({ status: "user", user: me });
    vi.mocked(authApi.authLogout).mockRejectedValueOnce(new authApi.AuthError("Không kết nối được backend", 0));
    await expect(auth().logout()).rejects.toThrow();
    expect(auth()).toMatchObject({ status: "user", user: me });
  });
});

describe("phiên hết hạn giữa chừng (/me/* trả 401)", () => {
  const respond401 = () => vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 401 }));

  it("mở popup đăng nhập lại, giữ nguyên status=user (không xoá hình chưa lưu)", async () => {
    useAuthStore.setState({ status: "user", user: me });
    respond401();
    await apiFetch("/me/drawings/XAU__default", { method: "PUT", body: "{}" });
    expect(auth()).toMatchObject({ status: "user", expired: true, dialog: { mode: "login" } });
    expect(auth().dialog?.reason).toMatch(/hết hạn/);
    // hết phiên thì Save/Buy… không được coi là đã đăng nhập: chờ người dùng đăng nhập lại, đóng popup thì false
    const p = auth().requireLogin("Lưu layout");
    auth().closeAuth();
    expect(await p).toBe(false);
  });

  it("đóng popup rồi lỗi 401 lặp lại thì không bật lại trong 60s", async () => {
    useAuthStore.setState({ status: "user", user: me });
    respond401();
    await apiFetch("/me/watchlist");
    auth().closeAuth();
    await apiFetch("/me/watchlist"); // DrawingSync retry mỗi 5s
    expect(auth().dialog).toBeNull();
    vi.setSystemTime(Date.now() + 61_000);
    await apiFetch("/me/watchlist");
    expect(auth().dialog).not.toBeNull();
  });

  it("khách gọi /me/* lỡ 401 thì không bật popup (chỉ user mới có 'hết hạn')", async () => {
    useAuthStore.setState({ status: "guest" });
    respond401();
    await apiFetch("/me/watchlist");
    expect(auth().dialog).toBeNull();
  });

  it("/auth/me 401 là chuyện bình thường của khách, không phải hết phiên", async () => {
    useAuthStore.setState({ status: "user", user: me });
    respond401();
    await apiFetch("/auth/me");
    expect(auth().dialog).toBeNull();
  });
});
