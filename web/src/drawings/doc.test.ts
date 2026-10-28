import { useAuthStore } from "@/store/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawingDoc, acquireDoc, closeAllDocs, openDocCount, releaseDoc, type DocView } from "./doc";
import type { Drawing } from "./types";

type Call = { url: string; method: string; body?: { version: number; items: unknown[] } };

// Backend giả (như sync.test.ts): GET trả rows[url] (404 nếu chưa có), PUT ghi đè.
function backend(rows: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input).split("?")[0];
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (method === "PUT") { rows[url] = body; return new Response("{}"); }
    return url in rows ? new Response(JSON.stringify({ id: url, data: rows[url] })) : new Response("", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls, rows, puts: () => calls.filter((c) => c.method === "PUT"), gets: () => calls.filter((c) => c.method === "GET") };
}

const opts = (be: ReturnType<typeof backend>) => ({ fetch: be.fetch, url: (s: string) => `/d/${s}`, saveDelay: 500, retryDelay: 5000 });
const line = (id: string): Drawing => ({ id, type: "trendline", points: [{ time: 1, price: 1 }, { time: 2, price: 2 }], color: "#fff", width: 1, locked: false, hidden: false });

function view() {
  return { docChanged: vi.fn(), docLoaded: vi.fn(), docReset: vi.fn() } satisfies DocView;
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  closeAllDocs();
  vi.useRealTimers();
  useAuthStore.setState({ status: "loading", user: null });
});

describe("registry: một doc cho mỗi symbol, đếm tham chiếu", () => {
  it("hai view cùng symbol dùng chung doc, chỉ đọc server 1 lần", async () => {
    const be = backend();
    const a = view(), b = view();
    const d1 = acquireDoc("XAU", a, "L", opts(be));
    const d2 = acquireDoc("XAU", b, "L", opts(be));
    await settle();
    expect(d1).toBe(d2);
    expect(be.gets()).toHaveLength(1);
    expect(acquireDoc("EUR", view(), "L", opts(be))).not.toBe(d1);
    expect(openDocCount()).toBe(2);
  });

  it("view cuối đi thì doc lưu nốt thay đổi chưa lưu rồi đóng; view đầu đi thì doc còn", async () => {
    const be = backend();
    const a = view(), b = view();
    const doc = acquireDoc("GBP", a, "L", opts(be));
    acquireDoc("GBP", b, "L", opts(be));
    await settle();
    doc.drawings = [line("d1")];
    doc.changed(a);
    releaseDoc(doc, a);
    expect(openDocCount()).toBe(1);
    expect(be.puts()).toHaveLength(0);
    releaseDoc(doc, b); // đóng: flush
    await settle();
    expect(be.puts()).toHaveLength(1);
    expect((be.puts()[0].body!.items[0] as Drawing).id).toBe("d1");
    expect(openDocCount()).toBe(0);
  });

  it("PUT cuối lỗi: doc giữ lại và thử tiếp tới khi lưu được; mở lại lúc đó dùng chính doc này (không đọc bản cũ)", async () => {
    const be = backend();
    let down = false;
    const f = (async (u: string | URL | Request, i?: RequestInit) => {
      if (down && i?.method === "PUT") throw new TypeError("Failed to fetch");
      return be.fetch(u, i);
    }) as typeof globalThis.fetch;
    const o = { ...opts(be), fetch: f };
    const a = view();
    const doc = acquireDoc("NZD", a, "L", o);
    await settle();
    doc.drawings = [line("d1")];
    doc.changed(a);
    down = true;
    releaseDoc(doc, a); // đổi symbol lúc mạng chớp
    await settle();
    expect(openDocCount()).toBe(1); // trước đây: doc bỏ ngay, d1 mất
    const b = view();
    expect(acquireDoc("NZD", b, "L", o)).toBe(doc);
    expect(be.gets()).toHaveLength(1);
    releaseDoc(doc, b);
    down = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect((be.rows["/d/NZD"] as { items: Drawing[] }).items.map((x) => x.id)).toEqual(["d1"]);
    expect(openDocCount()).toBe(0);
  });

  it("layout khác nhau thì doc khác nhau (cùng symbol)", () => {
    const be = backend();
    const x = acquireDoc("AUD", view(), "L1", opts(be));
    const y = acquireDoc("AUD", view(), "L2", opts(be));
    expect(x).not.toBe(y);
  });

  it("release view lạ / lần 2 không làm lệch bộ đếm", async () => {
    const be = backend();
    const a = view();
    const doc = acquireDoc("CAD", a, "L", opts(be));
    releaseDoc(doc, view()); // view chưa đăng ký
    expect(openDocCount()).toBeGreaterThan(0);
    releaseDoc(doc, a);
    releaseDoc(doc, a); // lần 2: bỏ qua
    await settle();
  });
});

describe("sửa ở một view, các view khác thấy", () => {
  it("changed(origin) báo view khác, không báo chính nó; chỉ 1 PUT cho cả hai", async () => {
    const be = backend();
    const a = view(), b = view();
    const doc = acquireDoc("XAU2", a, "L", opts(be));
    acquireDoc("XAU2", b, "L", opts(be));
    await settle();
    doc.drawings = [line("d1")];
    doc.changed(a);
    expect(b.docChanged).toHaveBeenCalledTimes(1);
    expect(a.docChanged).not.toHaveBeenCalled();
    doc.drawings = [...doc.drawings, line("d2")];
    doc.changed(b);
    expect(a.docChanged).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(be.puts()).toHaveLength(1); // trước đây mỗi manager có sync riêng → 2 PUT đè nhau
    expect(be.puts()[0].body!.items).toHaveLength(2);
    releaseDoc(doc, a);
    releaseDoc(doc, b);
  });

  it("hình đã lưu có type app không biết được giữ nguyên khi lưu lại", async () => {
    const unknown = { id: "x", type: "from-the-future", points: [] };
    const be = backend({ "/d/JPY": { version: 1, items: [line("d0"), unknown] } });
    const a = view();
    const doc = acquireDoc("JPY", a, "L", opts(be));
    await settle();
    expect(doc.drawings.map((d) => d.id)).toEqual(["d0"]);
    expect(doc.kept).toEqual([unknown]);
    expect(a.docLoaded).toHaveBeenCalledWith([expect.objectContaining({ id: "d0" })]);
    doc.drawings = [...doc.drawings, line("d1")];
    doc.changed(a);
    await vi.advanceTimersByTimeAsync(600);
    expect(be.puts()[0].body!.items).toEqual([unknown, expect.objectContaining({ id: "d0" }), expect.objectContaining({ id: "d1" })]);
    releaseDoc(doc, a);
  });

  it("server về sau: hình vẽ trong lúc chờ nằm trên hình của server; lịch sử undo cũ bị bỏ", async () => {
    const be = backend({ "/d/CHF": { version: 1, items: [line("server")] } });
    const a = view();
    const doc = acquireDoc("CHF", a, "L", opts(be));
    doc.drawings = [line("local")]; // vẽ ngay trước khi load xong
    doc.undoStack.push("[]");
    await settle();
    expect(doc.drawings.map((d) => d.id)).toEqual(["server", "local"]);
    expect(doc.undoStack).toEqual([]);
    releaseDoc(doc, a);
  });
});

describe("đổi nơi lưu (đăng nhập / đăng xuất)", () => {
  it("mọi doc nạp lại, view được reset, hình chưa lưu của nơi cũ KHÔNG bị PUT sang nơi mới", async () => {
    const be = backend({ "/d/NZD": { version: 1, items: [line("server")] } });
    useAuthStore.setState({ status: "guest", user: null });
    const a = view();
    const doc = acquireDoc("NZD", a, "L", opts(be));
    await settle();
    doc.drawings = [...doc.drawings, line("guest-unsaved")];
    doc.changed(null); // chờ lưu 500ms
    useAuthStore.setState({ status: "user", user: { id: "u1", email: "a@b.co", name: "A" } });
    expect(a.docReset).toHaveBeenCalledTimes(1);
    expect(doc.drawings).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(be.puts()).toHaveLength(0);
    expect(be.gets()).toHaveLength(2); // nạp lại
    expect(doc.drawings.map((d) => d.id)).toEqual(["server"]);
    expect(a.docLoaded).toHaveBeenCalledTimes(2);
    releaseDoc(doc, a);
  });

  it("đổi trạng thái nhưng cùng nơi lưu (user → user cùng id) thì không nạp lại", async () => {
    const be = backend();
    useAuthStore.setState({ status: "user", user: { id: "u1", email: "a@b.co", name: "A" } });
    const a = view();
    const doc = acquireDoc("SEK", a, "L", opts(be));
    await settle();
    useAuthStore.setState({ user: { id: "u1", email: "a@b.co", name: "Đổi tên" } });
    expect(a.docReset).not.toHaveBeenCalled();
    releaseDoc(doc, a);
  });
});

describe("bản server / bản xem trước", () => {
  it("hình nhiều điểm thiếu điểm hoặc điểm hỏng: không hiện, giữ nguyên khi lưu", async () => {
    const bad = [
      { ...line("path1"), type: "path", points: [{ time: 1, price: 1 }] },
      { ...line("nan"), points: [{ time: 1, price: 1 }, { time: "x", price: 2 }] },
    ];
    const be = backend({ "/d/CHF": { version: 1, items: [...bad, line("ok")] } });
    const a = view();
    const doc = acquireDoc("CHF", a, "L", opts(be));
    await settle();
    expect(doc.drawings.map((x) => x.id)).toEqual(["ok"]);
    expect(doc.kept).toEqual(bad);
    releaseDoc(doc, a);
  });

  it("hình đang xem trước: lưu bản chốt, không lưu bản xem trước", async () => {
    const be = backend();
    const a = view();
    const doc = acquireDoc("JPY", a, "L", opts(be));
    await settle();
    const d = line("d1");
    doc.drawings = [d];
    doc.changed(a);
    await vi.advanceTimersByTimeAsync(500);
    doc.previewOf.set("d1", d);
    doc.drawings = [{ ...d, color: "#f00" }];
    doc.changed(a); // chart khác sửa hình khác trong lúc đang xem trước
    await vi.advanceTimersByTimeAsync(500);
    expect(be.puts()).toHaveLength(1); // bản chốt không đổi: không PUT
    releaseDoc(doc, a);
  });
});

describe("doc rỗng (chưa mở symbol)", () => {
  it("không lưu, không đọc, mọi thao tác an toàn", async () => {
    const doc = new DrawingDoc(null);
    doc.open();
    doc.changed(null);
    doc.reload();
    await expect(doc.flush()).resolves.toBe(true);
    doc.close();
  });
});
