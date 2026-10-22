import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adoptGuestDrawings, guestDocs, memoryFetch } from "./guest";
import { DrawingSync } from "./sync";

const url = (s: string) => `http://x/me/drawings/${s}__default`;
const doc = (...items: unknown[]) => ({ version: 1, items });

// Server giả cho adoptGuestDrawings: rows = hình đã có trên server.
function server(rows: Record<string, unknown> = {}, opts: { putFails?: boolean; down?: boolean } = {}) {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${u}`);
    if (opts.down) throw new TypeError("Failed to fetch");
    if (method === "PUT") {
      if (opts.putFails) return new Response("", { status: 500 });
      rows[u] = JSON.parse(String(init!.body));
      return new Response("{}");
    }
    return u in rows ? new Response(JSON.stringify({ id: u, data: rows[u] })) : new Response("", { status: 404 });
  }) as typeof fetch;
  return { f, rows, calls };
}

beforeEach(() => guestDocs.clear());

describe("memoryFetch", () => {
  it("GET trước khi có gì = 404; PUT rồi GET trả lại đúng nội dung, bỏ qua query ?scope=", async () => {
    expect((await memoryFetch(url("A"))).status).toBe(404);
    await memoryFetch(`${url("A")}?scope=A`, { method: "PUT", body: JSON.stringify(doc({ id: 1 })) });
    const r = await memoryFetch(url("A"));
    expect(await r.json()).toEqual({ id: url("A"), data: doc({ id: 1 }) });
    expect((await memoryFetch(url("B"))).status).toBe(404);
  });

  it("ghi đồng bộ: không cần đợi Promise để thấy dữ liệu (flushSave rồi adopt ngay)", () => {
    void memoryFetch(url("A"), { method: "PUT", body: JSON.stringify(doc(1)) });
    expect(guestDocs.size()).toBe(1);
  });
});

describe("DrawingSync ở chế độ khách", () => {
  afterEach(() => vi.useRealTimers());

  it("hình sống qua đổi symbol, không có request mạng", async () => {
    vi.useFakeTimers();
    const net = vi.spyOn(globalThis, "fetch");
    const m = { items: [] as unknown[] };
    const sync = new DrawingSync({
      url: (s) => url(s), items: () => m.items, onLoad: (it) => { m.items = [...it, ...m.items]; },
      fetch: memoryFetch, saveDelay: 500,
    });
    sync.open("XAU");
    await vi.advanceTimersByTimeAsync(0);
    m.items = [{ id: "d1" }];
    sync.schedule();
    await vi.advanceTimersByTimeAsync(600);
    sync.open("EUR"); // đổi symbol
    m.items = [];
    await vi.advanceTimersByTimeAsync(0);
    sync.open("XAU"); // quay lại
    m.items = [];
    await vi.advanceTimersByTimeAsync(0);
    expect(m.items).toEqual([{ id: "d1" }]);
    expect(net).not.toHaveBeenCalled();
    net.mockRestore();
  });

  it("abandon() bỏ hình đang giữ mà không lưu (đổi nơi lưu không được đè dữ liệu thật)", async () => {
    vi.useFakeTimers();
    const puts: string[] = [];
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PUT") puts.push(String(input));
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const m = { items: [] as unknown[] };
    const sync = new DrawingSync({ url: (s) => url(s), items: () => m.items, onLoad: () => {}, fetch: f, saveDelay: 500 });
    sync.open("XAU");
    await vi.advanceTimersByTimeAsync(0);
    m.items = [{ id: "guest-drawing" }];
    sync.schedule(); // có thay đổi chờ lưu
    sync.abandon();
    m.items = [];
    sync.open("XAU");
    await vi.advanceTimersByTimeAsync(2000);
    expect(puts).toEqual([]);
  });

  it("flush() trả Promise xong khi PUT trả lời; không có gì để lưu thì xong ngay", async () => {
    let release!: () => void;
    const f = (async (_i: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PUT") await new Promise<void>((r) => (release = r));
      return new Response("", { status: init?.method === "PUT" ? 200 : 404 });
    }) as typeof fetch;
    const m = { items: [] as unknown[] };
    const sync = new DrawingSync({ url: (s) => url(s), items: () => m.items, onLoad: () => {}, fetch: f });
    sync.open("XAU");
    await new Promise((r) => setTimeout(r, 0));
    await sync.flush(); // chưa thay đổi gì
    m.items = [{ id: 1 }];
    let done = false;
    const p = sync.flush().then(() => (done = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toBe(false);
    release();
    await p;
    expect(done).toBe(true);
  });
});

describe("adoptGuestDrawings", () => {
  const seed = async (sym: string, ...items: unknown[]) =>
    memoryFetch(`${url(sym)}?scope=${sym}`, { method: "PUT", body: JSON.stringify(doc(...items)) });

  it("server chưa có symbol đó → chuyển hình của khách lên", async () => {
    await seed("XAU", { id: "d1" });
    const s = server();
    expect(await adoptGuestDrawings(s.f)).toBe(1);
    expect(s.rows[url("XAU")]).toEqual(doc({ id: "d1" }));
    expect(guestDocs.size()).toBe(0);
  });

  it("server đã có hình → server thắng, hình khách bị bỏ, không PUT đè", async () => {
    await seed("XAU", { id: "guest" });
    const s = server({ [url("XAU")]: doc({ id: "server" }) });
    expect(await adoptGuestDrawings(s.f)).toBe(0);
    expect(s.rows[url("XAU")]).toEqual(doc({ id: "server" }));
    expect(s.calls.some((c) => c.startsWith("PUT"))).toBe(false);
    expect(guestDocs.size()).toBe(0);
  });

  it("symbol khách không vẽ gì (danh sách rỗng) thì bỏ qua, không tạo hàng rỗng trên server", async () => {
    await seed("EUR");
    const s = server();
    expect(await adoptGuestDrawings(s.f)).toBe(0);
    expect(s.calls).toEqual([]);
  });

  it("layout đích: hình của khách ('__default') đi vào layout sẽ mở sau đăng nhập ('__<id>')", async () => {
    await seed("XAU", { id: "d1" });
    const s = server();
    expect(await adoptGuestDrawings(s.f, "L2")).toBe(1);
    expect(s.rows).toEqual({ [url("XAU").replace("__default", "__L2")]: doc({ id: "d1" }) });
    expect(guestDocs.size()).toBe(0);
  });

  it("layout đích đã có hình ở symbol đó → server thắng, hình khách bị bỏ", async () => {
    await seed("XAU", { id: "guest" });
    const to = url("XAU").replace("__default", "__L2");
    const s = server({ [to]: doc({ id: "server" }) });
    expect(await adoptGuestDrawings(s.f, "L2")).toBe(0);
    expect(s.rows[to]).toEqual(doc({ id: "server" }));
    expect(s.calls.some((c) => c.startsWith("PUT"))).toBe(false);
  });

  it("PUT lỗi / backend sập → giữ hình trong bộ nhớ để thử lại sau", async () => {
    await seed("XAU", { id: "d1" });
    expect(await adoptGuestDrawings(server({}, { putFails: true }).f)).toBe(0);
    expect(guestDocs.size()).toBe(1);
    expect(await adoptGuestDrawings(server({}, { down: true }).f)).toBe(0);
    expect(guestDocs.size()).toBe(1);
    expect(await adoptGuestDrawings(server().f)).toBe(1); // lần sau được
    expect(guestDocs.size()).toBe(0);
  });
});
