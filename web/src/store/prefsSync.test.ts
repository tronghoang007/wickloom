import { drawingGlobal } from "@/drawings/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "./auth";
import { PrefsSync, SYNCED_KEYS, parsePrefs, parseToolDefaults } from "./prefsSync";

// backend giả: một document prefs của user đang đăng nhập
function makeBackend(initial: unknown = null) {
  const state = { doc: initial as unknown, down: false, putStatus: 0 };
  const log: string[] = [];
  const impl = (async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    log.push(`${method} ${input}`);
    if (state.down) throw new TypeError("Failed to fetch");
    if (method === "PUT") {
      if (state.putStatus) return new Response("", { status: state.putStatus });
      state.doc = JSON.parse(String(init!.body));
      return new Response("{}");
    }
    return state.doc === null ? new Response("", { status: 404 }) : new Response(JSON.stringify({ id: "default", data: state.doc }));
  }) as unknown as typeof fetch;
  return { state, log, impl, puts: () => log.filter((l) => l.startsWith("PUT")).length, doc: () => state.doc as Record<string, unknown> };
}

const me = { id: "u1", email: "a@b.co", name: "Anh" };
const g = () => drawingGlobal.getState();
const tools = () => g().toolDefaults;
const settle = () => vi.advanceTimersByTimeAsync(0);
const INITIAL = Object.fromEntries(SYNCED_KEYS.map((k) => [k, g()[k]]));
let sync: PrefsSync | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  drawingGlobal.setState(INITIAL);
  useAuthStore.setState({ status: "guest", user: null, expired: false });
});
afterEach(() => {
  sync?.stop();
  sync = null;
  vi.useRealTimers();
});

const start = (be: ReturnType<typeof makeBackend>, o = {}) => {
  sync = new PrefsSync({ fetch: be.impl, delay: 100, retryMs: 1000, ...o });
  sync.start();
};
const login = async () => {
  useAuthStore.setState({ status: "user", user: me });
  await settle();
};

describe("parse", () => {
  it("parseToolDefaults: chỉ nhận đúng dạng; không phải object → null", () => {
    expect(parseToolDefaults(null)).toBeNull();
    expect(parseToolDefaults([])).toBeNull();
    expect(parseToolDefaults({ frvp: { color: "#fff", width: 2, dash: 1, textColor: "#000", opts: { rows: 240, volume: "delta", values: true, bad: { x: 1 } } } })).toEqual({
      frvp: { color: "#fff", width: 2, dash: 1, textColor: "#000", opts: { rows: 240, volume: "delta", values: true } },
    });
    expect(parseToolDefaults({ a: 5, b: { color: 3, width: "x", dash: 7 }, c: [] })).toEqual({ b: {} });
  });

  it("parsePrefs: khoá đúng kiểu được nhận, sai kiểu / lạ / vị trí thanh yêu thích bị bỏ", () => {
    expect(parsePrefs("x")).toEqual({});
    expect(
      parsePrefs({
        v: 1, toolDefaults: { frvp: {} }, favorites: ["a", "b"], showFavs: false, magnet: true, magnetMode: "strong", stay: true, lastTool: { lines: "trend" }, cursor: "dot", favoritesPos: { x: 5, y: 5 },
      }),
    ).toEqual({ toolDefaults: { frvp: {} }, favorites: ["a", "b"], showFavs: false, magnet: true, magnetMode: "strong", stay: true, lastTool: { lines: "trend" }, cursor: "dot" });
    expect(parsePrefs({ favorites: [1], showFavs: "no", magnet: 1, magnetMode: "x", stay: null, lastTool: { a: 1 }, cursor: "laser" })).toEqual({});
  });
});

describe("PrefsSync", () => {
  it("khách: không gọi server", async () => {
    const be = makeBackend();
    start(be);
    g().setToolDefault("frvp", { opts: { rows: 240 } });
    drawingGlobal.setState({ magnet: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(be.log).toEqual([]);
  });

  it("đăng nhập: khoá server đã có thì server thắng (thay giá trị trên máy), khoá server chưa có giữ của máy và đưa lên", async () => {
    const be = makeBackend({ v: 1, toolDefaults: { frvp: { opts: { rows: 240 } } }, magnet: true });
    drawingGlobal.setState({ toolDefaults: { frvp: { opts: { rows: 24 } }, avp: { color: "#f00" } }, magnet: false, stay: true });
    start(be);
    await login();
    expect(tools()).toEqual({ frvp: { opts: { rows: 240 } } });
    expect(g().magnet).toBe(true);
    expect(g().stay).toBe(true); // server chưa có `stay`
    await vi.advanceTimersByTimeAsync(500);
    expect(be.doc()).toMatchObject({ v: 1, toolDefaults: { frvp: { opts: { rows: 240 } } }, magnet: true, stay: true }); // đã đưa khoá còn thiếu lên
  });

  it("server đã có đủ mọi khoá và bằng máy: không ghi lại", async () => {
    const be = makeBackend({ v: 1, ...Object.fromEntries(SYNCED_KEYS.map((k) => [k, g()[k]])) });
    start(be);
    await login();
    await vi.advanceTimersByTimeAsync(2000);
    expect(be.puts()).toBe(0);
  });

  it("tài khoản chưa có gì: toàn bộ tuỳ chọn trên máy (kể cả mặc định công cụ từ lúc là khách) được đưa lên", async () => {
    const be = makeBackend(null);
    drawingGlobal.setState({ toolDefaults: { frvp: { opts: { rows: 240 } } }, magnetMode: "strong" });
    start(be);
    await login();
    await vi.advanceTimersByTimeAsync(500);
    expect(be.doc()).toMatchObject({ v: 1, toolDefaults: { frvp: { opts: { rows: 240 } } }, magnetMode: "strong", favorites: g().favorites });
    expect(be.doc()).not.toHaveProperty("favoritesPos");
  });

  it("đổi mặc định / nam châm / yêu thích sau khi lấy xong: một PUT cho nhiều lần đổi; reset công cụ cũng lưu", async () => {
    const be = makeBackend({ v: 1, ...Object.fromEntries(SYNCED_KEYS.map((k) => [k, g()[k]])) });
    start(be);
    await login();
    g().setToolDefault("frvp", { opts: { rows: 240 } });
    g().setToolDefault("frvp", { color: "#2962ff" });
    drawingGlobal.setState({ magnet: true, favorites: ["trend"] });
    await vi.advanceTimersByTimeAsync(500);
    expect(be.puts()).toBe(1);
    expect(be.doc()).toMatchObject({ toolDefaults: { frvp: { color: "#2962ff", opts: { rows: 240 } } }, magnet: true, favorites: ["trend"] });
    g().resetToolDefault("frvp");
    await vi.advanceTimersByTimeAsync(500);
    expect(be.doc().toolDefaults).toEqual({});
  });

  it("đổi trước khi lấy xong: khoá vừa đổi bên máy thắng (mặc định công cụ gộp theo công cụ), khoá khác lấy của server", async () => {
    const be = makeBackend({ v: 1, toolDefaults: { avp: { color: "#0f0" }, frvp: { opts: { rows: 24 } } }, magnet: false, stay: true });
    start(be);
    useAuthStore.setState({ status: "user", user: me });
    g().setToolDefault("frvp", { opts: { rows: 240 } }); // trước khi /me/prefs trả lời
    drawingGlobal.setState({ magnet: true });
    await vi.advanceTimersByTimeAsync(500);
    expect(tools()).toEqual({ avp: { color: "#0f0" }, frvp: { opts: { rows: 240 } } });
    expect(g().magnet).toBe(true); // vừa bật bên máy này
    expect(g().stay).toBe(true); // không đổi bên máy: lấy của server
    expect(be.doc()).toMatchObject({ toolDefaults: { avp: { color: "#0f0" }, frvp: { opts: { rows: 240 } } }, magnet: true, stay: true });
  });

  it("lấy lỗi (backend tắt): thử lại, không ghi đè; PUT lỗi: thử lại cho tới khi lưu được", async () => {
    const be = makeBackend({ v: 1, toolDefaults: { frvp: { opts: { rows: 240 } } } });
    be.state.down = true;
    start(be);
    await login();
    expect(tools()).toEqual({});
    expect(be.puts()).toBe(0);
    be.state.down = false;
    await vi.advanceTimersByTimeAsync(1500);
    expect(tools()).toEqual({ frvp: { opts: { rows: 240 } } });
    await vi.advanceTimersByTimeAsync(500); // các khoá server thiếu được đưa lên

    be.state.putStatus = 500;
    g().setToolDefault("avp", { color: "#abc" });
    const before = be.puts();
    await vi.advanceTimersByTimeAsync(300);
    expect(be.puts()).toBe(before + 1);
    be.state.putStatus = 0;
    await vi.advanceTimersByTimeAsync(1500);
    expect(be.doc().toolDefaults).toMatchObject({ avp: { color: "#abc" } });
  });

  it("đăng xuất: ngừng lưu lên server, tuỳ chọn trên máy giữ nguyên", async () => {
    const be = makeBackend({ v: 1, toolDefaults: { frvp: { opts: { rows: 240 } } } });
    start(be);
    await login();
    await vi.advanceTimersByTimeAsync(500);
    const puts = be.puts();
    useAuthStore.setState({ status: "guest", user: null });
    await settle();
    g().setToolDefault("avp", { color: "#abc" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(be.puts()).toBe(puts);
    expect(tools()).toMatchObject({ frvp: { opts: { rows: 240 } }, avp: { color: "#abc" } });
  });
});
