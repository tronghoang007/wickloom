import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDoc, type LayoutDoc } from "./layoutDoc";
import { LayoutSync, type SaveState } from "./layoutSync";
import { buildTemplate } from "./layoutTree";
import { createPane } from "./paneStores";

// Layout giả có thể sửa: `cur.symbol`, `cur.name`, `cur.active`
function fixture() {
  const cur = { name: "L", symbol: "XAUUSDm", active: "p1" };
  const snapshot = (): LayoutDoc => {
    const panes = { p1: createPane("p1", { chart: { symbol: cur.symbol } }) };
    return buildDoc({ name: cur.name, templateId: "s", tree: buildTemplate("s", ["p1"]), order: ["p1"], panes, activeId: cur.active });
  };
  return { cur, snapshot, baseline: snapshot() };
}

type Call = { url: string; method: string; body?: LayoutDoc; keepalive?: boolean };
function backend() {
  const calls: Call[] = [];
  const mode = { status: 200, throwNet: false, hold: null as null | Promise<void> };
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined, keepalive: init?.keepalive });
    if (mode.hold) await mode.hold;
    if (mode.throwNet) throw new TypeError("Failed to fetch");
    return new Response("{}", { status: mode.status });
  }) as typeof globalThis.fetch;
  return { fetch, calls, mode, puts: () => calls.filter((c) => c.method === "PUT") };
}

function make(opts: { readonly?: boolean } = {}) {
  const fx = fixture();
  const be = backend();
  const states: SaveState[] = [];
  const saved: LayoutDoc[] = [];
  const sync = new LayoutSync({
    id: "abc", snapshot: fx.snapshot, baseline: fx.baseline, fetch: be.fetch, readonly: opts.readonly,
    onState: (s) => states.push(s), onSaved: (d) => saved.push(d), saveDelay: 1000, retryDelay: 5000,
  });
  return { ...fx, be, sync, states, saved };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("LayoutSync", () => {
  it("chưa đổi gì thì không PUT; trạng thái saved", async () => {
    const t = make();
    t.sync.schedule();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.be.puts()).toHaveLength(0);
    expect(t.sync.state).toBe("saved");
  });

  it("đổi → 'saving' ngay, gộp nhiều thay đổi thành 1 PUT sau 1s, rồi 'saved'", async () => {
    const t = make();
    t.cur.symbol = "EURUSD";
    t.sync.schedule();
    expect(t.sync.state).toBe("saving");
    t.cur.name = "Scalp";
    t.sync.schedule();
    await vi.advanceTimersByTimeAsync(999);
    expect(t.be.puts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5);
    expect(t.be.puts()).toHaveLength(1);
    expect(t.be.puts()[0].url).toBe("/me/layouts/abc");
    expect(t.be.puts()[0].body).toMatchObject({ name: "Scalp", version: 1 });
    expect(t.be.puts()[0].body!.panes.p1.chart.symbol).toBe("EURUSD");
    expect(t.sync.state).toBe("saved");
    expect(t.saved).toHaveLength(1);
    expect(t.states).toEqual(["saving", "saved"]);
  });

  it("đổi chart active hoặc lưu lại y nguyên không phải là thay đổi", async () => {
    const t = make();
    t.cur.active = "p9";
    t.sync.schedule();
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.be.puts()).toHaveLength(0);
  });

  it("sửa rồi hoàn về như đã lưu: bỏ lịch, về 'saved', không PUT", async () => {
    const t = make();
    t.cur.name = "X";
    t.sync.schedule();
    t.cur.name = "L";
    t.sync.schedule();
    expect(t.sync.state).toBe("saved");
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.be.puts()).toHaveLength(0);
  });

  it("đổi tiếp trong lúc đang PUT → PUT lần 2 với bản mới nhất", async () => {
    const t = make();
    let release!: () => void;
    t.be.mode.hold = new Promise<void>((r) => (release = r));
    t.cur.name = "A";
    t.sync.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.be.puts()).toHaveLength(1);
    t.cur.name = "B"; // đang bay
    t.sync.schedule();
    t.be.mode.hold = null;
    release();
    await vi.advanceTimersByTimeAsync(1100);
    expect(t.be.puts()).toHaveLength(2);
    expect(t.be.puts()[1].body!.name).toBe("B");
    expect(t.sync.state).toBe("saved");
  });

  it("lỗi mạng/500 → 'error', tự thử lại sau 5s rồi 'saved'", async () => {
    const t = make();
    t.be.mode.throwNet = true;
    t.cur.name = "A";
    t.sync.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sync.state).toBe("error");
    t.cur.name = "B"; // sửa tiếp khi đang lỗi: không dồn thêm lịch mới
    t.sync.schedule();
    expect(t.sync.state).toBe("error");
    t.be.mode.throwNet = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.sync.state).toBe("saved");
    expect(t.be.puts().at(-1)!.body!.name).toBe("B");
    t.be.mode.status = 500;
    t.cur.name = "C";
    t.sync.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sync.state).toBe("error");
  });

  it("retry() thử lại ngay khi đang lỗi", async () => {
    const t = make();
    t.be.mode.status = 500;
    t.cur.name = "A";
    t.sync.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sync.state).toBe("error");
    t.be.mode.status = 200;
    await t.sync.retry();
    expect(t.sync.state).toBe("saved");
  });

  it("401: 'expired', KHÔNG retry mù; resume() sau đăng nhập lại ghi phần đang giữ", async () => {
    const t = make();
    t.be.mode.status = 401;
    t.cur.name = "Chưa lưu";
    t.sync.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sync.state).toBe("expired");
    const n = t.be.puts().length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.be.puts()).toHaveLength(n); // không thử lại
    t.cur.name = "Sửa tiếp";
    t.sync.schedule(); // không dồn lịch khi hết phiên
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.be.puts()).toHaveLength(n);
    t.be.mode.status = 200;
    await t.sync.resume();
    expect(t.sync.state).toBe("saved");
    expect(t.be.puts().at(-1)!.body!.name).toBe("Sửa tiếp");
  });

  it("readonly (version lạ): không bao giờ PUT, kể cả flush/retry", async () => {
    const t = make({ readonly: true });
    expect(t.sync.state).toBe("readonly");
    t.cur.name = "X";
    t.sync.schedule();
    await t.sync.flush();
    await t.sync.retry();
    t.sync.flushOnUnload();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.be.puts()).toHaveLength(0);
  });

  it("flush() lưu ngay và chỉ xong khi server trả lời; không có gì để lưu thì xong ngay", async () => {
    const t = make();
    await t.sync.flush();
    expect(t.be.puts()).toHaveLength(0);
    t.cur.name = "A";
    t.sync.schedule();
    await t.sync.flush();
    expect(t.be.puts()).toHaveLength(1);
    expect(t.sync.state).toBe("saved");
  });

  it("close() lưu nốt rồi ngừng nhận thay đổi", async () => {
    const t = make();
    t.cur.name = "A";
    t.sync.schedule();
    await t.sync.close();
    expect(t.be.puts()).toHaveLength(1);
    t.cur.name = "B";
    t.sync.schedule();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.be.puts()).toHaveLength(1);
  });

  it("flushOnUnload dùng keepalive và chỉ khi có thay đổi", async () => {
    const t = make();
    t.sync.flushOnUnload();
    expect(t.be.puts()).toHaveLength(0);
    t.cur.name = "A";
    t.sync.flushOnUnload();
    expect(t.be.puts()).toHaveLength(1);
    expect(t.be.puts()[0].keepalive).toBe(true);
  });

  it("id có ký tự lạ được mã hoá trong URL", () => {
    const fx = fixture();
    const be = backend();
    const s = new LayoutSync({ id: "a/b c", snapshot: fx.snapshot, baseline: fx.baseline, fetch: be.fetch });
    fx.cur.name = "x";
    void s.flush();
    expect(be.puts()[0].url).toBe("/me/layouts/a%2Fb%20c");
  });
});
