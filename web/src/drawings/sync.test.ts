import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAWINGS_VERSION, DrawingSync } from "./sync";

type Call = { url: string; method: string; body?: { version: number; items: unknown[] } };

// Backend giả: GET trả `rows[id]` (404 nếu chưa có), PUT ghi đè. `down` = backend chưa chạy.
function backend(rows: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const state = { down: false, putFails: false };
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (state.down) throw new TypeError("Failed to fetch");
    const id = url.split("?")[0];
    if (method === "PUT") {
      if (state.putFails) return new Response("", { status: 500 });
      rows[id] = body;
      return new Response("{}");
    }
    return id in rows ? new Response(JSON.stringify({ id, data: rows[id] })) : new Response("", { status: 404 });
  });
  const puts = () => calls.filter((c) => c.method === "PUT");
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, puts, rows, state };
}

// Mô phỏng manager: danh sách local, onLoad đặt bản server bên dưới hình vẽ trong lúc chờ
function setup(be: ReturnType<typeof backend>) {
  const m = { items: [] as unknown[] };
  const sync = new DrawingSync({
    url: (s) => `/drawings/${s}`,
    items: () => m.items,
    onLoad: (items) => { m.items = [...items, ...m.items]; },
    fetch: be.fetch,
    saveDelay: 500,
    retryDelay: 5000,
  });
  const edit = (...add: unknown[]) => { m.items = [...m.items, ...add]; sync.schedule(); };
  return { m, sync, edit };
}

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("DrawingSync (lỗi #1)", () => {
  it("load lỗi thì không ghi đè server, load lại được thì gộp và lưu", async () => {
    const be = backend({ "/drawings/XAU": { items: ["cũ 1", "cũ 2"] } });
    const { m, sync, edit } = setup(be);
    be.state.down = true;
    sync.open("XAU");
    await tick();
    expect(sync.state).toBe("error");

    edit("mới");
    await tick(1000);
    expect(be.puts()).toHaveLength(0); // trước đây: PUT ["mới"] → mất 2 hình cũ

    be.state.down = false;
    await tick(5000); // tự thử load lại
    expect(sync.state).toBe("ready");
    expect(m.items).toEqual(["cũ 1", "cũ 2", "mới"]);
    await tick(500);
    expect(be.puts()).toHaveLength(1);
    expect(be.rows["/drawings/XAU"]).toEqual({ version: DRAWINGS_VERSION, items: ["cũ 1", "cũ 2", "mới"] });
  });

  it("vẽ trước khi GET trả về: chờ load xong mới lưu, không mất bản server", async () => {
    const be = backend({ "/drawings/XAU": { items: ["cũ"] } });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const realFetch = be.fetch;
    const slow = vi.fn(async (u: string | URL | Request, i?: RequestInit) => { await gate; return realFetch(u, i); });
    const { m, sync, edit } = setup({ ...be, fetch: slow as unknown as typeof fetch });
    sync.open("XAU");
    edit("mới");
    await tick(2000);
    expect(be.puts()).toHaveLength(0);

    release();
    await tick(500);
    expect(m.items).toEqual(["cũ", "mới"]);
    expect(be.rows["/drawings/XAU"]).toEqual({ version: DRAWINGS_VERSION, items: ["cũ", "mới"] });
  });

  it("404 = chưa có drawings: được lưu, kèm version", async () => {
    const be = backend();
    const { sync, edit } = setup(be);
    sync.open("XAU");
    await tick();
    expect(sync.state).toBe("ready");
    edit("a");
    await tick(500);
    expect(be.puts()[0].url).toBe("/drawings/XAU?scope=XAU");
    expect(be.puts()[0].body).toEqual({ version: DRAWINGS_VERSION, items: ["a"] });
  });

  it("đọc được bản cũ chưa có version", async () => {
    const be = backend({ "/drawings/XAU": { items: ["cũ"] } });
    const { m, sync } = setup(be);
    sync.open("XAU");
    await tick();
    expect(sync.state).toBe("ready");
    expect(m.items).toEqual(["cũ"]);
  });

  it("không PUT khi nội dung không đổi (chọn hình, Measure)", async () => {
    const be = backend({ "/drawings/XAU": { version: 1, items: ["a"] } });
    const { sync } = setup(be);
    sync.open("XAU");
    await tick(500);
    sync.schedule();
    sync.schedule();
    await tick(1000);
    expect(be.puts()).toHaveLength(0);
  });

  it("gộp nhiều thay đổi liên tiếp thành 1 PUT", async () => {
    const be = backend();
    const { sync, edit } = setup(be);
    sync.open("XAU");
    await tick();
    edit("a");
    await tick(200);
    edit("b");
    await tick(500);
    expect(be.puts()).toHaveLength(1);
    expect(be.puts()[0].body?.items).toEqual(["a", "b"]);
  });

  it("dữ liệu của version mới hơn: hiện nhưng không ghi đè", async () => {
    const be = backend({ "/drawings/XAU": { version: DRAWINGS_VERSION + 1, items: ["x"] } });
    const { m, sync, edit } = setup(be);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sync.open("XAU");
    await tick();
    expect(sync.state).toBe("readonly");
    expect(m.items).toEqual(["x"]);
    edit("a");
    await tick(1000);
    sync.flush();
    expect(be.puts()).toHaveLength(0);
  });

  it("dữ liệu hỏng (items không phải mảng): không ghi đè", async () => {
    const be = backend({ "/drawings/XAU": { items: "??" } });
    const { sync, edit } = setup(be);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sync.open("XAU");
    await tick();
    expect(sync.state).toBe("readonly");
    edit("a");
    await tick(1000);
    expect(be.puts()).toHaveLength(0);
  });

  it("đổi symbol: lưu nốt thay đổi đang chờ vào đúng symbol cũ", async () => {
    const be = backend();
    const { m, sync, edit } = setup(be);
    sync.open("XAU");
    await tick();
    edit("của XAU");
    sync.open("BTC"); // chưa hết 500ms
    m.items = [];
    await tick(1000);
    expect(be.puts()).toHaveLength(1);
    expect(be.puts()[0].url).toBe("/drawings/XAU?scope=XAU");
    expect(be.rows["/drawings/BTC"]).toBeUndefined();
  });

  it("GET của symbol cũ về muộn thì bỏ qua", async () => {
    const be = backend({ "/drawings/XAU": { items: ["xau"] }, "/drawings/BTC": { items: ["btc"] } });
    const { m, sync } = setup(be);
    sync.open("XAU");
    sync.open("BTC");
    await tick();
    expect(m.items).toEqual(["btc"]);
  });

  it("PUT lỗi thì thử lại", async () => {
    const be = backend();
    const { sync, edit } = setup(be);
    sync.open("XAU");
    await tick();
    be.state.putFails = true;
    edit("a");
    await tick(500);
    expect(be.rows["/drawings/XAU"]).toBeUndefined();
    be.state.putFails = false;
    await tick(5000);
    expect(be.rows["/drawings/XAU"]).toEqual({ version: DRAWINGS_VERSION, items: ["a"] });
  });

  it("gọi fetch không kèm this (window.fetch ném Illegal invocation nếu this khác window)", async () => {
    const be = backend({ "/drawings/XAU": { items: ["cũ"] } });
    const strict = function (this: unknown, u: string | URL | Request, i?: RequestInit) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return be.fetch(u, i);
    };
    const { m, sync, edit } = setup({ ...be, fetch: strict as typeof fetch });
    sync.open("XAU");
    await tick();
    expect(sync.state).toBe("ready");
    expect(m.items).toEqual(["cũ"]);
    edit("mới");
    await tick(500);
    expect(be.puts()).toHaveLength(1);
  });

  it("flush báo PUT lỗi (false) và tự thử lại tới khi lưu được", async () => {
    const be = backend();
    const { sync, edit } = setup(be);
    sync.open("XAU");
    await tick();
    edit("a");
    be.state.putFails = true;
    await expect(sync.flush()).resolves.toBe(false);
    be.state.putFails = false;
    await tick(5000);
    expect(be.puts()).toHaveLength(2);
    expect(be.rows["/drawings/XAU"]).toEqual({ version: 1, items: ["a"] });
    await expect(sync.flush()).resolves.toBe(true);
  });

  it("PUT xếp hàng: PUT sau chỉ gửi khi PUT trước đã trả lời, flush cùng nội dung đợi PUT đang chờ", async () => {
    const order: string[] = [];
    let release: (() => void) | null = null;
    const fetch = (async (_u: string, init?: RequestInit) => {
      if (init?.method !== "PUT") return new Response("", { status: 404 });
      const items = JSON.parse(String(init.body)).items.join(",");
      order.push(`start ${items}`);
      if (items === "a") await new Promise<void>((r) => { release = r; });
      order.push(`end ${items}`);
      return new Response("{}");
    }) as typeof globalThis.fetch;
    const { sync, edit } = setup({ ...backend(), fetch });
    sync.open("XAU");
    await tick();
    edit("a");
    const p1 = sync.flush();
    const same = sync.flush(); // chưa đổi gì: đợi đúng PUT đang chờ
    edit("b");
    const p2 = sync.flush();
    await tick();
    expect(order).toEqual(["start a"]);
    release!();
    await expect(Promise.all([p1, same, p2])).resolves.toEqual([true, true, true]);
    expect(order).toEqual(["start a", "end a", "start a,b", "end a,b"]);
  });

  it("close() lưu nốt rồi ngừng", async () => {
    const be = backend();
    const { sync, edit } = setup(be);
    sync.open("XAU");
    await tick();
    edit("a");
    sync.close();
    await tick();
    expect(be.puts()).toHaveLength(1);
    edit("b");
    await tick(1000);
    expect(be.puts()).toHaveLength(1);
  });
});
