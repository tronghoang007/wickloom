import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mt5Account, TradeData } from "@/lib/mt5Api";

const fetchMock = vi.fn();
vi.mock("@/lib/mt5Api", () => ({ fetchTrade: (...a: unknown[]) => fetchMock(...a), fetchMt5Accounts: vi.fn() }));

import { useMt5Store } from "@/store/mt5";
import { TRADE_POLL_MS, startTradePolling, useTradeStore } from "./store";

const acc = { id: "S:1", server: "S", online: true, active: true } as Mt5Account;
const td = { account: acc, positions: [], orders: [], deals: [], updated_at: 1 } as TradeData;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  useMt5Store.setState({ accounts: [acc], loaded: true });
  useTradeStore.getState().clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useTradeStore.refresh", () => {
  it("hỏi đúng account đang active", async () => {
    fetchMock.mockResolvedValue({ data: td, unauthorized: false, gone: false });
    await useTradeStore.getState().refresh();
    expect(fetchMock).toHaveBeenCalledWith("S:1");
    expect(useTradeStore.getState().data).toBe(td);
  });

  it("không có account active → xoá dữ liệu, không gọi backend", async () => {
    fetchMock.mockResolvedValue({ data: td, unauthorized: false, gone: false });
    await useTradeStore.getState().refresh();
    useMt5Store.setState({ accounts: [] });
    await useTradeStore.getState().refresh();
    expect(useTradeStore.getState().data).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lỗi mạng giữ bản cũ; 401 hoặc 404 xoá để không còn hiện vị thế cũ", async () => {
    fetchMock.mockResolvedValueOnce({ data: td, unauthorized: false, gone: false });
    await useTradeStore.getState().refresh();
    fetchMock.mockResolvedValueOnce({ data: null, unauthorized: false, gone: false });
    await useTradeStore.getState().refresh();
    expect(useTradeStore.getState().data).toBe(td);
    fetchMock.mockResolvedValueOnce({ data: null, unauthorized: true, gone: false });
    await useTradeStore.getState().refresh();
    expect(useTradeStore.getState().data).toBeNull();
    fetchMock.mockResolvedValueOnce({ data: td, unauthorized: false, gone: false });
    await useTradeStore.getState().refresh();
    fetchMock.mockResolvedValueOnce({ data: null, unauthorized: false, gone: true });
    await useTradeStore.getState().refresh();
    expect(useTradeStore.getState().data).toBeNull();
  });
});

describe("useTradeStore.refresh: trả lời chồng nhau / đổi account", () => {
  const later = () => {
    let resolve!: (v: unknown) => void;
    return { p: new Promise((r) => (resolve = r)), resolve: (v: unknown) => resolve(v) };
  };

  it("trả lời của lần hỏi cũ về sau lần hỏi mới thì bỏ (không cho vị thế vừa đóng hiện lại)", async () => {
    const old = later();
    const fresh = later();
    fetchMock.mockReturnValueOnce(old.p).mockReturnValueOnce(fresh.p);
    const r1 = useTradeStore.getState().refresh();
    const r2 = useTradeStore.getState().refresh();
    const newer = { ...td, updated_at: 2 };
    fresh.resolve({ data: newer, unauthorized: false, gone: false });
    await r2;
    old.resolve({ data: { ...td, positions: [{ ticket: 9 }] }, unauthorized: false, gone: false });
    await r1;
    expect(useTradeStore.getState().data).toBe(newer);
  });

  it("đổi account MT5 lúc đang chờ: trả lời của account cũ bị bỏ cùng vị thế cũ", async () => {
    fetchMock.mockResolvedValueOnce({ data: td, unauthorized: false, gone: false });
    await useTradeStore.getState().refresh();
    const slow = later();
    fetchMock.mockReturnValueOnce(slow.p);
    const r = useTradeStore.getState().refresh(); // hỏi S:1
    const acc2 = { ...acc, id: "S:2" };
    useMt5Store.setState({ accounts: [{ ...acc, active: false }, acc2] }); // người dùng đổi account trong MT5
    slow.resolve({ data: td, unauthorized: false, gone: false });
    await r;
    expect(useTradeStore.getState().data).toBeNull(); // trả lời của S:1 về sau khi đổi: bỏ, và không còn hiện vị thế của S:1
    const td2 = { ...td, account: acc2 };
    fetchMock.mockResolvedValueOnce({ data: td2, unauthorized: false, gone: false });
    await useTradeStore.getState().refresh();
    expect(useTradeStore.getState().data).toBe(td2);
  });

  it("hỏi lần đầu sau khi đổi account: bỏ ngay vị thế account cũ trong lúc chờ", async () => {
    fetchMock.mockResolvedValueOnce({ data: td, unauthorized: false, gone: false });
    await useTradeStore.getState().refresh();
    const acc2 = { ...acc, id: "S:2" };
    useMt5Store.setState({ accounts: [acc2] });
    const slow = later();
    fetchMock.mockReturnValueOnce(slow.p);
    const r = useTradeStore.getState().refresh();
    expect(useTradeStore.getState().data).toBeNull();
    slow.resolve({ data: { ...td, account: acc2 }, unauthorized: false, gone: false });
    await r;
    expect(useTradeStore.getState().data?.account.id).toBe("S:2");
  });
});

describe("panel state + polling", () => {
  it("showTab chọn tab và mở panel", () => {
    useTradeStore.getState().setOpen(false);
    useTradeStore.getState().showTab("history");
    expect(useTradeStore.getState()).toMatchObject({ tab: "history", open: true });
  });

  it("hỏi ngay rồi mỗi TRADE_POLL_MS; tab ẩn thì bỏ lượt; dừng thì thôi", async () => {
    fetchMock.mockResolvedValue({ data: td, unauthorized: false, gone: false });
    const stop = startTradePolling();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TRADE_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.stubGlobal("document", { hidden: true });
    await vi.advanceTimersByTimeAsync(TRADE_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
    vi.stubGlobal("document", { hidden: false });
    await vi.advanceTimersByTimeAsync(TRADE_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
