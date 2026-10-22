import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mt5Account } from "@/lib/mt5Api";

const fetchMock = vi.fn();
vi.mock("@/lib/mt5Api", () => ({ fetchMt5Accounts: (...a: unknown[]) => fetchMock(...a) }));

import { POLL_MS, startMt5Polling, useMt5Store } from "./mt5";

const acc = { id: "S:1", server: "S", broker: "B", login: 1, name: "", mode: "demo", currency: "USD", leverage: 500, online: true, active: true, seen: 1 } as Mt5Account;
const ok = (accounts: Mt5Account[], switchable = false) => ({ list: { accounts, switchable }, unauthorized: false });

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  useMt5Store.getState().clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useMt5Store.refresh", () => {
  it("nhận danh sách từ backend", async () => {
    fetchMock.mockResolvedValue(ok([acc]));
    await useMt5Store.getState().refresh();
    expect(useMt5Store.getState()).toMatchObject({ accounts: [acc], loaded: true, switchable: false });
  });

  it("lỗi mạng giữ danh sách cũ; 401 (hết phiên / đăng xuất) xoá sạch để không giữ số dư", async () => {
    fetchMock.mockResolvedValueOnce(ok([acc]));
    await useMt5Store.getState().refresh();
    fetchMock.mockResolvedValueOnce({ list: null, unauthorized: false });
    await useMt5Store.getState().refresh();
    expect(useMt5Store.getState().accounts).toEqual([acc]);
    fetchMock.mockResolvedValueOnce({ list: null, unauthorized: true });
    await useMt5Store.getState().refresh();
    expect(useMt5Store.getState()).toMatchObject({ accounts: [], loaded: false });
  });
});

describe("startMt5Polling", () => {
  it("hỏi ngay rồi mỗi POLL_MS; dừng thì thôi; tab ẩn thì bỏ lượt", async () => {
    fetchMock.mockResolvedValue(ok([acc]));
    const stop = startMt5Polling();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.stubGlobal("document", { hidden: true });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.stubGlobal("document", { hidden: false });
    stop();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
