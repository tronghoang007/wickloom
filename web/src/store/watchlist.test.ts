import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "./auth";
import { useToastStore } from "./toast";
import { editWatchlist, loadWatchlist, resetWatchlist, stopWatchlistRetry, useWatchlistStore } from "./watchlist";

// backend giả: watchlist theo user đang "giữ cookie"
function makeBackend() {
  const docs = new Map<string, string[]>();
  const st = { who: "u1", getStatus: 0 };
  const log: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    log.push(`${method} ${st.who}`);
    if (method === "PUT") {
      docs.set(st.who, JSON.parse(String(init!.body)).symbols);
      return new Response("{}");
    }
    if (st.getStatus) return new Response("", { status: st.getStatus });
    const d = docs.get(st.who);
    return d ? new Response(JSON.stringify({ id: "default", data: { symbols: d } })) : new Response("", { status: 404 });
  }) as typeof fetch;
  return { docs, st, log, impl, puts: () => log.filter((l) => l.startsWith("PUT")) };
}

const u1 = { id: "u1", email: "a@b.co", name: "A" };
const u2 = { id: "u2", email: "b@b.co", name: "B" };
const W = () => useWatchlistStore.getState();
let be: ReturnType<typeof makeBackend>;

beforeEach(() => {
  vi.useFakeTimers();
  be = makeBackend();
  vi.spyOn(globalThis, "fetch").mockImplementation(be.impl);
  resetWatchlist();
  useToastStore.setState({ items: [] });
  useAuthStore.setState({ status: "user", user: u1, expired: false });
});
afterEach(() => {
  stopWatchlistRetry();
  resetWatchlist();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("watchlist", () => {
  it("nạp lỗi (5xx): không coi là rỗng, không cho sửa (không PUT đè); thử lại tới khi được", async () => {
    be.docs.set("u1", ["XAUUSDm", "BTCUSDm", "EURUSD"]);
    be.st.getStatus = 500;
    await loadWatchlist("u1");
    expect(W().status).toBe("error");
    expect(editWatchlist(["GBPUSD"])).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(be.puts()).toEqual([]);
    be.st.getStatus = 0;
    await vi.advanceTimersByTimeAsync(5000);
    expect(W()).toMatchObject({ status: "ready", symbols: ["XAUUSDm", "BTCUSDm", "EURUSD"] });
    expect(editWatchlist([...W().symbols, "GBPUSD"])).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(be.docs.get("u1")).toEqual(["XAUUSDm", "BTCUSDm", "EURUSD", "GBPUSD"]);
  });

  it("chưa có watchlist (404) → rỗng, sửa được", async () => {
    await loadWatchlist("u1");
    expect(W()).toMatchObject({ status: "ready", symbols: [] });
    editWatchlist(["XAUUSDm"]);
    await vi.advanceTimersByTimeAsync(600);
    expect(be.docs.get("u1")).toEqual(["XAUUSDm"]);
  });

  it("đang nạp thì chưa sửa được", () => {
    void loadWatchlist("u1");
    expect(W().status).toBe("loading");
    expect(editWatchlist(["XAUUSDm"])).toBe(false);
  });

  it("đổi tài khoản trước khi kịp lưu: KHÔNG PUT danh sách của user cũ bằng cookie của user mới", async () => {
    be.docs.set("u1", ["XAUUSDm"]);
    be.docs.set("u2", ["EURUSD"]);
    await loadWatchlist("u1");
    editWatchlist([]);
    be.st.who = "u2";
    useAuthStore.setState({ user: u2 });
    await vi.advanceTimersByTimeAsync(600);
    expect(be.puts()).toEqual([]);
    expect(be.docs.get("u2")).toEqual(["EURUSD"]);
    await loadWatchlist("u2");
    expect(W()).toMatchObject({ uid: "u2", symbols: ["EURUSD"], status: "ready" });
  });

  it("mở lại panel khi còn thay đổi chờ lưu: giữ bản trên máy, không nạp đè", async () => {
    be.docs.set("u1", ["XAUUSDm"]);
    await loadWatchlist("u1");
    editWatchlist(["XAUUSDm", "EURUSD"]);
    await loadWatchlist("u1");
    expect(W().symbols).toEqual(["XAUUSDm", "EURUSD"]);
    await vi.advanceTimersByTimeAsync(600);
    expect(be.docs.get("u1")).toEqual(["XAUUSDm", "EURUSD"]);
  });

  it("lưu lỗi: báo cho người dùng", async () => {
    await loadWatchlist("u1");
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response("", { status: 500 }));
    editWatchlist(["XAUUSDm"]);
    await vi.advanceTimersByTimeAsync(600);
    expect(useToastStore.getState().items.at(-1)!.text).toMatch(/watchlist/);
  });
});
