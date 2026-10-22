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
