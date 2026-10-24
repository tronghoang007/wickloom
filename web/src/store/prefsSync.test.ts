import { drawingGlobal } from "@/drawings/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "./auth";
import { PrefsSync, parseToolDefaults } from "./prefsSync";

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
  return { state, log, impl, puts: () => log.filter((l) => l.startsWith("PUT")).length };
}

const me = { id: "u1", email: "a@b.co", name: "Anh" };
const tools = () => drawingGlobal.getState().toolDefaults;
const settle = () => vi.advanceTimersByTimeAsync(0);
let sync: PrefsSync | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  drawingGlobal.setState({ toolDefaults: {} });
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

describe("parseToolDefaults", () => {
  it("chỉ nhận đúng dạng; không phải object → null", () => {
    expect(parseToolDefaults(null)).toBeNull();
    expect(parseToolDefaults([])).toBeNull();
    expect(parseToolDefaults({ frvp: { color: "#fff", width: 2, dash: 1, textColor: "#000", opts: { rows: 240, volume: "delta", values: true, bad: { x: 1 } } } })).toEqual({
      frvp: { color: "#fff", width: 2, dash: 1, textColor: "#000", opts: { rows: 240, volume: "delta", values: true } },
    });
    expect(parseToolDefaults({ a: 5, b: { color: 3, width: "x", dash: 7 }, c: [] })).toEqual({ b: {} });
  });
});

describe("PrefsSync", () => {
  it("khách: không gọi server", async () => {
    const be = makeBackend();
    start(be);
    drawingGlobal.getState().setToolDefault("frvp", { opts: { rows: 240 } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(be.log).toEqual([]);
  });

  it("đăng nhập: server đã có thì server thắng (thay mặc định trên máy)", async () => {
    const be = makeBackend({ v: 1, toolDefaults: { frvp: { opts: { rows: 240 } } } });
    drawingGlobal.setState({ toolDefaults: { frvp: { opts: { rows: 24 } }, avp: { color: "#f00" } } });
    start(be);
    await login();
    expect(tools()).toEqual({ frvp: { opts: { rows: 240 } } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(be.puts()).toBe(0); // vừa lấy về: không ghi lại
  });

  it("tài khoản chưa có gì: mặc định đang có trên máy được đưa lên; máy không có gì thì không ghi", async () => {
    const be = makeBackend(null);
    drawingGlobal.setState({ toolDefaults: { frvp: { opts: { rows: 240 } } } });
    start(be);
    await login();
    await vi.advanceTimersByTimeAsync(500);
    expect(be.state.doc).toEqual({ v: 1, toolDefaults: { frvp: { opts: { rows: 240 } } } });

    sync!.stop();
    const empty = makeBackend(null);
    drawingGlobal.setState({ toolDefaults: {} });
    useAuthStore.setState({ status: "guest", user: null });
    start(empty);
    await login();
    await vi.advanceTimersByTimeAsync(2000);
    expect(empty.puts()).toBe(0);
  });

  it("đổi mặc định (Row Size 24 → 240) sau khi lấy xong: lưu lên server, gộp nhiều lần đổi thành một PUT", async () => {
    const be = makeBackend({ v: 1, toolDefaults: {} });
    start(be);
    await login();
    drawingGlobal.getState().setToolDefault("frvp", { opts: { rows: 240 } });
    drawingGlobal.getState().setToolDefault("frvp", { color: "#2962ff" });
    await vi.advanceTimersByTimeAsync(500);
    expect(be.puts()).toBe(1);
    expect(be.state.doc).toEqual({ v: 1, toolDefaults: { frvp: { color: "#2962ff", opts: { rows: 240 } } } });
    drawingGlobal.getState().resetToolDefault("frvp");
    await vi.advanceTimersByTimeAsync(500);
    expect(be.state.doc).toEqual({ v: 1, toolDefaults: {} });
  });

  it("đổi trước khi lấy xong: gộp theo công cụ (bên vừa đổi thắng), phần còn lại giữ của server", async () => {
    const be = makeBackend({ v: 1, toolDefaults: { avp: { color: "#0f0" }, frvp: { opts: { rows: 24 } } } });
    start(be);
    useAuthStore.setState({ status: "user", user: me });
    drawingGlobal.getState().setToolDefault("frvp", { opts: { rows: 240 } }); // trước khi /me/prefs trả lời
    await vi.advanceTimersByTimeAsync(500);
    expect(tools()).toEqual({ avp: { color: "#0f0" }, frvp: { opts: { rows: 240 } } });
    expect(be.state.doc).toEqual({ v: 1, toolDefaults: { avp: { color: "#0f0" }, frvp: { opts: { rows: 240 } } } });
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

    be.state.putStatus = 500;
    drawingGlobal.getState().setToolDefault("avp", { color: "#abc" });
    await vi.advanceTimersByTimeAsync(300);
    expect(be.puts()).toBe(1);
    be.state.putStatus = 0;
    await vi.advanceTimersByTimeAsync(1500);
    expect((be.state.doc as { toolDefaults: object }).toolDefaults).toMatchObject({ avp: { color: "#abc" } });
  });

  it("đăng xuất: ngừng lưu lên server, mặc định trên máy giữ nguyên", async () => {
    const be = makeBackend({ v: 1, toolDefaults: { frvp: { opts: { rows: 240 } } } });
    start(be);
    await login();
    useAuthStore.setState({ status: "guest", user: null });
    await settle();
    drawingGlobal.getState().setToolDefault("avp", { color: "#abc" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(be.puts()).toBe(0);
    expect(tools()).toMatchObject({ frvp: { opts: { rows: 240 } }, avp: { color: "#abc" } });
  });
});
