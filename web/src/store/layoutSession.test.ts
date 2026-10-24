import { guestDocs, memoryFetch } from "@/drawings/guest";
import * as authApi from "@/lib/authApi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authHooks, useAuthStore } from "./auth";
import { DEFAULT_LAYOUT_ID, PRIMARY_PANE_ID, getPane, snapshotLayout, useLayoutStore } from "./layout";
import { buildDoc, docKey, type LayoutDoc } from "./layoutDoc";
import { createLayoutSession, guestDoc, useSessionStore, type Session } from "./layoutSession";
import { buildTemplate } from "./layoutTree";
import { createPane } from "./paneStores";
import { DEFAULT_SETTINGS, mergeSettings, useSettingsStore } from "./settings";
import { SETTINGS_KEY } from "./settingsStorage";
import { useToastStore } from "./toast";

vi.mock("@/lib/authApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/authApi")>()),
  authMe: vi.fn(),
  authLogin: vi.fn(),
  authRegister: vi.fn(),
  authLogout: vi.fn(),
}));

const me = { id: "u1", email: "a@b.co", name: "Anh" };
const L = () => useLayoutStore.getState();
const settle = () => vi.advanceTimersByTimeAsync(0);

// --- backend giả có trạng thái ------------------------------------------------------------------------------------
function makeBackend() {
  const layouts = new Map<string, unknown>();
  const drawings = new Map<string, unknown>();
  const log: string[] = [];
  const mode = { down: false, putLayoutStatus: 0 };
  const json = (v: unknown) => new Response(JSON.stringify(v));
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = decodeURIComponent(u.pathname);
    log.push(`${method} ${path}`);
    if (mode.down) throw new TypeError("Failed to fetch");
    const m = path.match(/^\/me\/(layouts|drawings)(?:\/(.+))?$/);
    if (!m) return new Response("", { status: 404 });
    const store = m[1] === "layouts" ? layouts : drawings;
    const id = m[2];
    if (mode.putLayoutStatus && method === "PUT" && m[1] === "layouts") return new Response("", { status: mode.putLayoutStatus });
    if (!id) return json(Array.from(store, ([i, data]) => ({ id: i, data })));
    if (method === "GET") return store.has(id) ? json({ id, data: store.get(id) }) : new Response("", { status: 404 });
    if (method === "PUT") { store.set(id, JSON.parse(String(init!.body))); return json({ ok: true }); }
    if (method === "DELETE") { store.delete(id); return json({ ok: true }); }
    return new Response("", { status: 405 });
  }) as typeof fetch;
  return { layouts, drawings, log, mode, impl, puts: (what = "/me/layouts") => log.filter((l) => l.startsWith("PUT") && l.includes(what)) };
}

function fakeKv(init: Record<string, string> = {}) {
  const data = { ...init };
  return { data, getItem: (k: string) => (k in data ? data[k] : null), setItem: (k: string, v: string) => { data[k] = v; }, removeItem: (k: string) => { delete data[k]; } };
}

const docOf = (name: string, symbol: string, updatedAt: number, tf = "M5"): LayoutDoc =>
  buildDoc({ name, templateId: "s", tree: buildTemplate("s", ["p1"]), order: ["p1"], panes: { p1: createPane("p1", { chart: { symbol, tf } }) }, activeId: "p1" }, updatedAt);

let be: ReturnType<typeof makeBackend>;
let kv: ReturnType<typeof fakeKv>;
let session: Session;

const startSession = (init: Record<string, string> = {}) => {
  kv = fakeKv(init);
  vi.stubGlobal("localStorage", kv);
  session = createLayoutSession(kv, { retryMs: 5000, now: () => 1_700_000_000_000 });
  session.start();
};

const loginAs = async (user = me) => {
  vi.mocked(authApi.authLogin).mockResolvedValueOnce({ user });
  await useAuthStore.getState().login(user.email, "pw-pw-pw-1");
  await session.ready();
  await settle();
};

beforeEach(() => {
  vi.useFakeTimers();
  be = makeBackend();
  vi.spyOn(globalThis, "fetch").mockImplementation(be.impl);
  L().applyLayout(guestDoc({}), DEFAULT_LAYOUT_ID);
  useAuthStore.setState({ status: "guest", user: null, hint: null, expired: false, dialog: null });
  useSessionStore.setState({ saveState: "guest", dialog: null, entries: null, entriesLoading: false });
  useToastStore.setState({ items: [] });
  guestDocs.clear();
  useSettingsStore.setState({ s: DEFAULT_SETTINGS });
  vi.mocked(authApi.authLogin).mockReset();
  vi.mocked(authApi.authLogout).mockReset();
});
afterEach(() => {
  session?.stop();
  useAuthStore.getState().closeAuth();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("khách", () => {
  it("không gọi server; pane chính vẫn nhớ prefs qua wickloom-pane1", () => {
    startSession();
    expect(be.log).toEqual([]);
    expect(useSessionStore.getState().saveState).toBe("guest");
    expect(session.mode).toBe("guest");
    expect(JSON.parse(kv.data["wickloom-pane1"]).chart.symbol).toBe("XAUUSDm");
    getPane(PRIMARY_PANE_ID).chart.setState({ symbol: "EURUSD" });
    vi.advanceTimersByTime(400);
    expect(JSON.parse(kv.data["wickloom-pane1"]).chart.symbol).toBe("EURUSD");
  });
});

describe("đăng nhập", () => {
  it("user chưa có layout nào → tạo 'default' từ màn hình hiện tại", async () => {
    startSession();
    getPane(PRIMARY_PANE_ID).chart.setState({ symbol: "EURUSD", tf: "H1" });
    const rev = L().revision;
    await loginAs();
    const stored = be.layouts.get("default") as LayoutDoc;
    expect(stored.name).toBe("Default");
    expect(stored.panes.p1.chart).toMatchObject({ symbol: "EURUSD", tf: "H1" });
    expect(L().layoutId).toBe("default");
    expect(L().revision).toBe(rev); // cùng id: chart không bị dựng lại
    expect(useSessionStore.getState().saveState).toBe("saved");
    expect(session.mode).toBe("user");
    expect(JSON.parse(kv.data["wickloom-layout-current:u1"]).id).toBe("default");
  });

  it("user đã có layout → mở layout gần nhất (thay màn hình khách)", async () => {
    be.layouts.set("old", docOf("Cũ", "GBPUSD", 100));
    be.layouts.set("new", docOf("Mới", "BTCUSDm", 200, "H1"));
    startSession();
    const rev = L().revision;
    await loginAs();
    expect(L().layoutId).toBe("new");
    expect(L().name).toBe("Mới");
    expect(getPane("p1").chart.getState()).toMatchObject({ symbol: "BTCUSDm", tf: "H1" });
    expect(L().revision).toBeGreaterThan(rev);
    expect(be.puts()).toEqual([]); // mở layout có sẵn không ghi gì
  });

  it("ưu tiên layout user đã mở lần trước (cache theo user)", async () => {
    be.layouts.set("old", docOf("Cũ", "GBPUSD", 100));
    be.layouts.set("new", docOf("Mới", "BTCUSDm", 200));
    startSession({ "wickloom-layout-current:u1": JSON.stringify({ id: "old", doc: docOf("Cũ", "GBPUSD", 100) }) });
    await loginAs();
    expect(L().layoutId).toBe("old");
  });

  it("Save lúc là khách → đăng nhập → lưu màn hình vào tài khoản, KHÔNG ghi đè layout có sẵn", async () => {
    const existing = docOf("Của tôi", "GBPUSD", 100);
    be.layouts.set("mine", existing);
    startSession();
    getPane(PRIMARY_PANE_ID).chart.setState({ symbol: "EURUSD" });
    const saving = session.save();
    await settle();
    expect(useAuthStore.getState().dialog?.reason).toMatch(/lưu layout/);
    await loginAs();
    await saving;
    const ids = [...be.layouts.keys()];
    expect(ids).toHaveLength(2);
    const newId = ids.find((i) => i !== "mine")!;
    expect((be.layouts.get(newId) as LayoutDoc).panes.p1.chart.symbol).toBe("EURUSD");
    expect((be.layouts.get(newId) as LayoutDoc).name).toMatch(/^Chart /);
    expect(be.layouts.get("mine")).toBe(existing); // nguyên vẹn
    expect(L().layoutId).toBe(newId);
    const t = useToastStore.getState().items.at(-1)!;
    expect(t.text).toMatch(/Đã lưu thành/);
    expect(t.action?.label).toBe("Mở layout của tôi");
  });

  it("hình vẽ của khách đi theo vào layout mới được tạo", async () => {
    be.layouts.set("mine", docOf("Của tôi", "GBPUSD", 100));
    startSession();
    await memoryFetch("http://127.0.0.1:8000/me/drawings/EURUSD__default", { method: "PUT", body: JSON.stringify({ version: 1, items: [{ id: "d1" }] }) });
    const saving = session.save();
    await settle();
    await loginAs();
    await saving;
    const newId = [...be.layouts.keys()].find((i) => i !== "mine")!;
    expect(be.drawings.get(`EURUSD__${newId}`)).toEqual({ version: 1, items: [{ id: "d1" }] });
    expect(be.drawings.has("EURUSD__default")).toBe(false);
  });

  it("lần đầu (chưa có layout) hình khách vào layout 'default'", async () => {
    startSession();
    await memoryFetch("http://127.0.0.1:8000/me/drawings/EURUSD__default", { method: "PUT", body: JSON.stringify({ version: 1, items: [{ id: "d1" }] }) });
    await loginAs();
    expect(be.drawings.get("EURUSD__default")).toEqual({ version: 1, items: [{ id: "d1" }] });
  });

  it("lỗi tải danh sách lúc đăng nhập: không tạo/ghi gì, báo error, thử lại được", async () => {
    startSession();
    be.mode.down = true;
    await loginAs();
    expect(useSessionStore.getState().saveState).toBe("error");
    expect(be.puts()).toEqual([]);
    be.mode.down = false;
    await vi.advanceTimersByTimeAsync(5100);
    await settle();
    expect(useSessionStore.getState().saveState).toBe("saved");
    expect(be.layouts.has("default")).toBe(true);
  });

  it("layout 'default' có sẵn nhưng không đọc được (version lạ): không ghi đè, tạo layout mới", async () => {
    const future = { version: 99, name: "Từ tương lai", panes: {} };
    be.layouts.set("default", future);
    startSession();
    await loginAs();
    expect(be.layouts.get("default")).toBe(future);
    expect(L().layoutId).not.toBe("default");
    expect(be.layouts.size).toBe(2);
  });
});

describe("autosave", () => {
  it("đổi state chart → PUT sau 1s; đổi chart active không PUT", async () => {
    startSession();
    await loginAs();
    const base = be.puts().length;
    getPane(PRIMARY_PANE_ID).chart.setState({ symbol: "XAGUSD" });
    await vi.advanceTimersByTimeAsync(1100);
    expect(be.puts()).toHaveLength(base + 1);
    expect((be.layouts.get("default") as LayoutDoc).panes.p1.chart.symbol).toBe("XAGUSD");
    expect(useSessionStore.getState().saveState).toBe("saved");
    L().setActive(PRIMARY_PANE_ID);
    await vi.advanceTimersByTimeAsync(3000);
    expect(be.puts()).toHaveLength(base + 1);
  });

  it("đổi mẫu chia ô / thêm indicator / đổi tên đều lưu", async () => {
    startSession();
    await loginAs();
    L().setTemplate("2h");
    await vi.advanceTimersByTimeAsync(1100);
    expect(Object.keys((be.layouts.get("default") as LayoutDoc).panes)).toEqual(["p1", "p2"]);
    getPane("p2").indicators.getState().add("sma");
    await vi.advanceTimersByTimeAsync(1100);
    expect((be.layouts.get("default") as LayoutDoc).panes.p2.indicators).toHaveLength(1);
    L().setName("Scalp");
    await vi.advanceTimersByTimeAsync(1100);
    expect((be.layouts.get("default") as LayoutDoc).name).toBe("Scalp");
  });

  it("hết phiên giữa chừng (PUT 401): expired, giữ layout trong bộ nhớ; đăng nhập lại → ghi tiếp", async () => {
    startSession();
    await loginAs();
    be.mode.putLayoutStatus = 401;
    getPane(PRIMARY_PANE_ID).chart.setState({ symbol: "EURGBP" });
    await vi.advanceTimersByTimeAsync(1100);
    expect(useSessionStore.getState().saveState).toBe("expired");
    const n = be.puts().length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(be.puts()).toHaveLength(n); // không retry mù
    expect(getPane(PRIMARY_PANE_ID).chart.getState().symbol).toBe("EURGBP"); // layout còn nguyên trong bộ nhớ
    be.mode.putLayoutStatus = 0;
    useAuthStore.setState({ expired: true });
    useAuthStore.setState({ expired: false }); // đăng nhập lại xong
    await settle();
    expect(useSessionStore.getState().saveState).toBe("saved");
    expect((be.layouts.get("default") as LayoutDoc).panes.p1.chart.symbol).toBe("EURGBP");
  });

  it("Ctrl+S / Save: lưu ngay không chờ debounce; đang lỗi thì thử lại ngay", async () => {
    startSession();
    await loginAs();
    be.mode.putLayoutStatus = 500;
    getPane(PRIMARY_PANE_ID).chart.setState({ symbol: "NZDUSD" });
    await vi.advanceTimersByTimeAsync(1100);
    expect(useSessionStore.getState().saveState).toBe("error");
    be.mode.putLayoutStatus = 0;
    await session.save();
    expect(useSessionStore.getState().saveState).toBe("saved");
    expect((be.layouts.get("default") as LayoutDoc).panes.p1.chart.symbol).toBe("NZDUSD");
  });
});

describe("mở / tạo / sao chép / xoá", () => {
  const seed = async () => {
    startSession();
    await loginAs(); // tạo 'default'
    be.layouts.set("other", docOf("Khác", "BTCUSDm", 5, "H4"));
    be.drawings.set("BTCUSDm__other", { version: 1, items: [{ id: "b1" }] });
    be.drawings.set("XAUUSDm__default", { version: 1, items: [{ id: "x1" }] });
    be.drawings.set("EURUSD__default", { version: 1, items: [{ id: "e1" }] });
  };

  it("mở layout khác: lưu nốt layout cũ trước, rồi thay màn hình; nhớ làm layout hiện tại", async () => {
    await seed();
    getPane(PRIMARY_PANE_ID).chart.setState({ symbol: "XPTUSD" }); // chưa kịp autosave
    await session.open("other");
    await settle();
    expect((be.layouts.get("default") as LayoutDoc).panes.p1.chart.symbol).toBe("XPTUSD"); // đã lưu trước khi rời
    expect(L().layoutId).toBe("other");
    expect(getPane("p1").chart.getState()).toMatchObject({ symbol: "BTCUSDm", tf: "H4" });
    expect(JSON.parse(kv.data["wickloom-layout-current:u1"]).id).toBe("other");
    expect(useSessionStore.getState().saveState).toBe("saved");
    // sync mới theo layout mới
    getPane("p1").chart.setState({ tf: "D1" });
    await vi.advanceTimersByTimeAsync(1100);
    expect((be.layouts.get("other") as LayoutDoc).panes.p1.chart.tf).toBe("D1");
  });

  it("không mở được layout lỗi/version lạ", async () => {
    await seed();
    be.layouts.set("future", { version: 99, name: "Tương lai" });
    await session.open("future");
    expect(L().layoutId).toBe("default");
    expect(useToastStore.getState().items.at(-1)!.text).toMatch(/Không mở được/);
  });

  it("tạo layout mới: 1 chart cùng symbol/khung của chart active, mở luôn", async () => {
    await seed();
    getPane(PRIMARY_PANE_ID).chart.setState({ symbol: "USDJPY", tf: "H1", chartType: "line" });
    await session.create("  Swing  ");
    const id = L().layoutId;
    expect(id).not.toBe("default");
    expect(L().name).toBe("Swing");
    expect(getPane("p1").chart.getState()).toMatchObject({ symbol: "USDJPY", tf: "H1", chartType: "line" });
    expect(getPane("p1").indicators.getState().list).toEqual([]);
    expect((be.layouts.get(id) as LayoutDoc).name).toBe("Swing");
  });

  it("sao chép: layout + hình vẽ của layout cũ sang id mới, mở bản sao; bản gốc không đổi", async () => {
    await seed();
    await session.copy("Bản sao");
    const copyId = L().layoutId;
    expect(copyId).not.toBe("default");
    expect(L().name).toBe("Bản sao");
    expect(be.drawings.get(`XAUUSDm__${copyId}`)).toEqual({ version: 1, items: [{ id: "x1" }] });
    expect(be.drawings.get(`EURUSD__${copyId}`)).toEqual({ version: 1, items: [{ id: "e1" }] });
    expect(be.drawings.get("XAUUSDm__default")).toEqual({ version: 1, items: [{ id: "x1" }] }); // gốc còn
    expect(be.drawings.has(`BTCUSDm__${copyId}`)).toBe(false); // hình của layout khác không bị lẫn
  });

  it("xoá layout không phải layout đang mở: xoá luôn hình vẽ của nó", async () => {
    await seed();
    await session.remove("other");
    expect(be.layouts.has("other")).toBe(false);
    expect(be.drawings.has("BTCUSDm__other")).toBe(false);
    expect(be.drawings.has("XAUUSDm__default")).toBe(true);
    expect(L().layoutId).toBe("default");
  });

  it("xoá layout đang mở: mở layout còn lại, KHÔNG tạo lại layout vừa xoá", async () => {
    await seed();
    await session.remove("default");
    await vi.advanceTimersByTimeAsync(3000);
    expect(be.layouts.has("default")).toBe(false);
    expect(be.drawings.has("XAUUSDm__default")).toBe(false);
    expect(L().layoutId).toBe("other");
  });

  it("không xoá layout cuối cùng", async () => {
    startSession();
    await loginAs();
    await session.remove("default");
    expect(be.layouts.has("default")).toBe(true);
    expect(useToastStore.getState().items.at(-1)!.text).toMatch(/cuối cùng/);
  });

  it("thao tác của khách đều bị chặn bằng đăng nhập; đóng popup thì không làm gì", async () => {
    startSession();
    const p = session.create("X");
    await settle();
    expect(useAuthStore.getState().dialog).not.toBeNull();
    useAuthStore.getState().closeAuth();
    await p;
    expect(be.log).toEqual([]);
  });

  it("danh sách cho dialog Open: sắp theo mới nhất, kèm tóm tắt, bản không đọc được vẫn liệt kê", async () => {
    await seed();
    be.layouts.set("future", { version: 99, name: "Tương lai" });
    await session.openDialog();
    const s = useSessionStore.getState();
    expect(s.dialog).toBe("open");
    expect(s.entries!.map((e) => e.id)).toContain("future");
    const other = s.entries!.find((e) => e.id === "other")!;
    expect(other.summary).toBe("BTCUSDm 4h");
    expect(s.entries!.find((e) => e.id === "future")).toMatchObject({ doc: null, bad: "version" });
  });
});

describe("mở nhanh từ cache khi reload", () => {
  const cacheOf = (doc: LayoutDoc, id = "L1") => ({ "wickloom-layout-current:u1": JSON.stringify({ id, doc }) });
  const hint = { "wickloom-auth-hint": JSON.stringify({ name: "Anh", id: "u1" }) };
  beforeEach(() => useAuthStore.setState({ status: "loading" })); // lúc mở trang chưa biết là khách hay user

  it("áp layout cache ngay (chưa cần backend), chart không bị dựng lại khi server trả cùng bản", async () => {
    const doc = docOf("Của tôi", "BTCUSDm", 100, "H1");
    be.layouts.set("L1", doc);
    startSession({ ...hint, ...cacheOf(doc) });
    expect(session.mode).toBe("optimistic");
    expect(L().layoutId).toBe("L1");
    expect(getPane("p1").chart.getState()).toMatchObject({ symbol: "BTCUSDm", tf: "H1" });
    expect(useSessionStore.getState().saveState).toBe("loading");
    const rev = L().revision;
    useAuthStore.setState({ status: "user", user: me });
    await session.ready();
    await settle();
    expect(session.mode).toBe("user");
    expect(L().revision).toBe(rev);
    expect(be.puts()).toEqual([]);
  });

  it("backend tắt khi reload: vẫn thấy layout, sửa thêm được lưu vào cache, KHÔNG ghi gì lên server", async () => {
    const doc = docOf("Của tôi", "BTCUSDm", 100);
    startSession({ ...hint, ...cacheOf(doc) });
    be.mode.down = true;
    getPane("p1").chart.setState({ symbol: "ETHUSD" });
    await vi.advanceTimersByTimeAsync(400);
    expect(JSON.parse(kv.data["wickloom-layout-current:u1"]).doc.panes.p1.chart.symbol).toBe("ETHUSD");
    expect(be.puts()).toEqual([]);
  });

  it("backend lên lại: bản sửa lúc offline thắng bản cũ trên server và được lưu lên", async () => {
    const doc = docOf("Của tôi", "BTCUSDm", 100);
    be.layouts.set("L1", doc);
    startSession({ ...hint, ...cacheOf(doc) });
    getPane("p1").chart.setState({ symbol: "ETHUSD" }); // sửa lúc chưa biết đã đăng nhập chưa
    useAuthStore.setState({ status: "user", user: me });
    await session.ready();
    await vi.advanceTimersByTimeAsync(1200);
    expect(getPane("p1").chart.getState().symbol).toBe("ETHUSD");
    expect((be.layouts.get("L1") as LayoutDoc).panes.p1.chart.symbol).toBe("ETHUSD");
  });

  it("server có bản khác (sửa ở máy khác) mà máy này không sửa gì → lấy bản server", async () => {
    const cached = docOf("Của tôi", "BTCUSDm", 100);
    be.layouts.set("L1", docOf("Của tôi", "SOLUSD", 200));
    startSession({ ...hint, ...cacheOf(cached) });
    useAuthStore.setState({ status: "user", user: me });
    await session.ready();
    expect(getPane("p1").chart.getState().symbol).toBe("SOLUSD");
  });

  it("phiên đã hết (khách) → bỏ layout cache, về 1 chart từ prefs khách", async () => {
    startSession({ ...hint, ...cacheOf(docOf("Của tôi", "BTCUSDm", 100)), "wickloom-pane1": JSON.stringify({ chart: { symbol: "EURUSD", tf: "M30" } }) });
    useAuthStore.setState({ status: "guest" });
    await settle();
    expect(session.mode).toBe("guest");
    expect(L().layoutId).toBe("default");
    expect(getPane("p1").chart.getState()).toMatchObject({ symbol: "EURUSD", tf: "M30" });
    expect(be.puts()).toEqual([]);
  });

  it("cache hỏng / thiếu hint → bắt đầu như khách", () => {
    startSession({ ...hint, "wickloom-layout-current:u1": "{not json" });
    expect(session.mode).toBe("guest");
    session.stop();
    startSession({ "wickloom-layout-current:u1": JSON.stringify({ id: "L1", doc: docOf("x", "A", 1) }) });
    expect(session.mode).toBe("guest");
  });
});

describe("đăng xuất", () => {
  it("lưu nốt layout TRƯỚC khi xoá cookie, rồi về khách với 1 chart từ prefs", async () => {
    startSession({ "wickloom-pane1": JSON.stringify({ chart: { symbol: "EURUSD", tf: "M30" } }) });
    await loginAs();
    getPane("p1").chart.setState({ symbol: "XAGUSD" }); // chưa kịp autosave
    const order: string[] = [];
    vi.mocked(authApi.authLogout).mockImplementation(async () => {
      order.push(`logout after ${be.puts().length} puts`);
      return { ok: true };
    });
    await useAuthStore.getState().logout();
    expect((be.layouts.get("default") as LayoutDoc).panes.p1.chart.symbol).toBe("XAGUSD");
    expect(order[0]).toMatch(/after [1-9]\d* puts/);
    expect(session.mode).toBe("guest");
    expect(useSessionStore.getState().saveState).toBe("guest");
    expect(getPane("p1").chart.getState()).toMatchObject({ symbol: "EURUSD", tf: "M30" });
    expect(L().layoutId).toBe("default");
  });

  it("layout chưa lưu được (backend lỗi) → huỷ đăng xuất, vẫn đăng nhập", async () => {
    startSession();
    await loginAs();
    be.mode.putLayoutStatus = 500;
    getPane("p1").chart.setState({ symbol: "XAGUSD" });
    await expect(useAuthStore.getState().logout()).rejects.toThrow();
    expect(useAuthStore.getState().status).toBe("user");
    expect(authApi.authLogout).not.toHaveBeenCalled();
  });
});

describe("hook auth", () => {
  it("stop() gỡ hook và không nghe auth nữa", async () => {
    startSession();
    session.stop();
    expect(authHooks.beforeLogin).toBeUndefined();
    expect(authHooks.beforeLogout).toBeUndefined();
    useAuthStore.setState({ status: "user", user: me });
    await settle();
    expect(be.log).toEqual([]);
  });

  it("snapshotLayout phản ánh màn hình (dùng làm bản lưu)", async () => {
    startSession();
    L().setTemplate("2h");
    expect(Object.keys(snapshotLayout().panes)).toEqual(["p1", "p2"]);
    expect(docKey(snapshotLayout())).toContain("2h");
  });
});

describe("setting chart nằm trong layout", () => {
  const settingsOf = (id: string) => (be.layouts.get(id) as LayoutDoc).settings;
  const withSettings = (doc: LayoutDoc, s: Partial<typeof DEFAULT_SETTINGS>): LayoutDoc => ({ ...doc, settings: mergeSettings(s) });
  const guestSaved = (s: object) => ({ [SETTINGS_KEY]: JSON.stringify({ state: { s }, version: 3 }) });
  const S = () => useSettingsStore.getState().s;

  it("khách: nhớ vào localStorage (key tv-chart-settings)", () => {
    startSession(guestSaved({ fontSize: 15 }));
    expect(S().fontSize).toBe(15);
    useSettingsStore.getState().set({ bg: "#202020" });
    expect(JSON.parse(kv.data[SETTINGS_KEY]).state.s).toMatchObject({ fontSize: 15, bg: "#202020" });
  });

  it("user: layout mới tạo từ màn hình mang theo setting của khách; đổi setting → autosave vào layout, KHÔNG ghi localStorage", async () => {
    startSession(guestSaved({ bg: "#101010" }));
    await loginAs();
    expect(settingsOf("default")?.bg).toBe("#101010");
    const guestJson = kv.data[SETTINGS_KEY];
    useSettingsStore.getState().set({ bg: "#202020", fontSize: 14 });
    await vi.advanceTimersByTimeAsync(1100);
    expect(settingsOf("default")).toMatchObject({ bg: "#202020", fontSize: 14 });
    expect(useSessionStore.getState().saveState).toBe("saved");
    expect(kv.data[SETTINGS_KEY]).toBe(guestJson); // chế độ user: key của khách đứng yên
  });

  it("mở layout khác thì setting đổi theo layout đó; mở lại layout cũ lấy lại đúng setting của nó", async () => {
    be.layouts.set("a", withSettings(docOf("A", "EURUSD", 200), { bg: "#101010" }));
    be.layouts.set("b", withSettings(docOf("B", "GBPUSD", 100), { bg: "#ffeedd", fontSize: 16 }));
    startSession();
    await loginAs();
    expect(L().layoutId).toBe("a");
    expect(S().bg).toBe("#101010");
    expect(be.puts()).toEqual([]); // mở layout có sẵn không ghi gì
    await session.open("b");
    expect(S()).toMatchObject({ bg: "#ffeedd", fontSize: 16 });
    await session.open("a");
    expect(S()).toMatchObject({ bg: "#101010", fontSize: DEFAULT_SETTINGS.fontSize });
  });

  it("layout cũ chưa lưu setting: dùng setting đang hiện (của khách), mở ra không ghi gì; Save thì lưu setting vào", async () => {
    be.layouts.set("old", docOf("Cũ", "EURUSD", 100));
    startSession(guestSaved({ fontSize: 15 }));
    await loginAs();
    expect(S().fontSize).toBe(15);
    expect(be.puts()).toEqual([]);
    await session.save();
    expect(settingsOf("old")?.fontSize).toBe(15);
  });

  it("đổi setting rồi Save/autosave: layout khác không bị ảnh hưởng", async () => {
    be.layouts.set("a", withSettings(docOf("A", "EURUSD", 200), { bg: "#101010" }));
    be.layouts.set("b", withSettings(docOf("B", "GBPUSD", 100), { bg: "#303030" }));
    startSession();
    await loginAs();
    useSettingsStore.getState().set({ bg: "#abcdef" });
    await vi.advanceTimersByTimeAsync(1100);
    expect(settingsOf("a")?.bg).toBe("#abcdef");
    expect(settingsOf("b")?.bg).toBe("#303030");
  });

  it("reload mở nhanh từ cache: setting lấy từ layout cache; cache cũ chưa có setting thì dùng của khách và KHÔNG bị coi là 'đã sửa'", async () => {
    const hint = { "wickloom-auth-hint": JSON.stringify({ name: "Anh", id: "u1" }) };
    useAuthStore.setState({ status: "loading" });
    const withS = withSettings(docOf("Của tôi", "BTCUSDm", 100), { bg: "#101010" });
    startSession({ ...hint, "wickloom-layout-current:u1": JSON.stringify({ id: "L1", doc: withS }), ...guestSaved({ bg: "#999999" }) });
    expect(S().bg).toBe("#101010");
    session.stop();

    be.layouts.set("L2", docOf("Cũ", "BTCUSDm", 100)); // server: bản cũ chưa có setting
    startSession({ ...hint, "wickloom-layout-current:u1": JSON.stringify({ id: "L2", doc: docOf("Cũ", "BTCUSDm", 100) }), ...guestSaved({ fontSize: 15 }) });
    const rev = L().revision;
    expect(S().fontSize).toBe(15);
    useAuthStore.setState({ status: "user", user: me });
    await session.ready();
    await settle();
    expect(L().revision).toBe(rev); // chart không bị dựng lại
    await vi.advanceTimersByTimeAsync(1500); // quá hạn autosave: nếu bị coi là "đã sửa" thì đã PUT đè server
    expect(be.puts()).toEqual([]);
  });

  it("đăng xuất về khách: lấy lại setting của khách, không mang setting của layout vừa rời", async () => {
    be.layouts.set("a", withSettings(docOf("A", "EURUSD", 200), { bg: "#101010" }));
    startSession(guestSaved({ fontSize: 15 }));
    await loginAs();
    expect(S().bg).toBe("#101010");
    vi.mocked(authApi.authLogout).mockResolvedValue({ ok: true });
    await useAuthStore.getState().logout();
    expect(session.mode).toBe("guest");
    expect(S()).toMatchObject({ bg: null, fontSize: 15 });
    useSettingsStore.getState().set({ bg: "#555555" });
    expect(JSON.parse(kv.data[SETTINGS_KEY]).state.s.bg).toBe("#555555"); // khách lại ghi localStorage
  });

  it("Create new layout: layout mới chép setting đang hiện", async () => {
    startSession();
    await loginAs();
    useSettingsStore.getState().set({ bg: "#123456" });
    await session.create("Mới");
    const created = [...be.layouts.entries()].find(([, d]) => (d as LayoutDoc).name === "Mới")!;
    expect((created[1] as LayoutDoc).settings?.bg).toBe("#123456");
  });
});
