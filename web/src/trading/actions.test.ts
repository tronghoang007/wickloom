import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mt5Account } from "@/lib/mt5Api";
import type { TradeOutcome } from "@/lib/tradeApi";

const sendOrder = vi.fn();
const sendClose = vi.fn();
vi.mock("@/lib/tradeApi", () => ({ sendMarketOrder: (...a: unknown[]) => sendOrder(...a), sendClosePosition: (...a: unknown[]) => sendClose(...a) }));
const requireLogin = vi.fn();
vi.mock("@/store/auth", () => ({ useAuthStore: { getState: () => ({ requireLogin }) } }));
const toastMock = vi.fn();
vi.mock("@/store/toast", () => ({ toast: (...a: unknown[]) => toastMock(...a) }));
const refresh = vi.fn();
vi.mock("./store", () => ({ useTradeStore: { getState: () => ({ refresh }) } }));

import { useMt5Store } from "@/store/mt5";
import { closeTrade, newClientId, placeMarket, useOrderState } from "./actions";

const acc = { id: "S:1", server: "S", mode: "demo", online: true, active: true } as Mt5Account;
const done = (o: Partial<{ ok: boolean; message: string; price: number }> = {}): TradeOutcome => ({
  kind: "done", result: { ok: true, message: "", retcode: 10009, order: 1, deal: 2, price: 4131.25, volume: 0.1, ...o },
});

beforeEach(() => {
  vi.useFakeTimers();
  for (const m of [sendOrder, sendClose, requireLogin, toastMock, refresh]) m.mockReset();
  requireLogin.mockResolvedValue(true);
  useMt5Store.setState({ accounts: [acc], loaded: true });
  useOrderState.setState({ busy: false });
});
afterEach(() => vi.useRealTimers());

describe("placeMarket", () => {
  it("đòi đăng nhập trước; khách đóng popup thì không gửi gì", async () => {
    requireLogin.mockResolvedValue(false);
    await placeMarket("buy", "XAUUSDm", 0.1);
    expect(requireLogin).toHaveBeenCalledOnce();
    expect(sendOrder).not.toHaveBeenCalled();
    expect(useOrderState.getState().busy).toBe(false);
  });

  it("gửi lên account đang active với client_id riêng mỗi lần bấm, toast kết quả, rồi làm mới vị thế", async () => {
    sendOrder.mockResolvedValue(done());
    await placeMarket("sell", "XAUUSDm", 0.1, 3);
    await placeMarket("sell", "XAUUSDm", 0.1, 3);
    const [id1, o1] = sendOrder.mock.calls[0];
    const [, o2] = sendOrder.mock.calls[1];
    expect(id1).toBe("S:1");
    expect(o1).toMatchObject({ symbol: "XAUUSDm", side: "sell", volume: 0.1 });
    expect(o1.clientId).toMatch(/^[A-Za-z0-9_-]{8,32}$/);
    expect(o1.clientId).not.toBe(o2.clientId); // hai lần bấm = hai lệnh khác nhau
    expect(toastMock.mock.calls[0][0]).toBe("Sell 0.10 XAUUSDm @ 4131.250");
    await vi.advanceTimersByTimeAsync(2000);
    expect(refresh).toHaveBeenCalled();
  });

  it("sàn từ chối → toast message, không làm mới như thành công", async () => {
    sendOrder.mockResolvedValue(done({ ok: false, message: "Không đủ margin" }));
    await placeMarket("buy", "XAUUSDm", 5);
    expect(toastMock.mock.calls[0][0]).toBe("Không đủ margin");
    await vi.advanceTimersByTimeAsync(2000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("lỗi chưa rõ kết quả (504/mất mạng) → toast dài + làm mới để thấy vị thế có thể đã khớp", async () => {
    sendOrder.mockResolvedValue({ kind: "error", status: 504, message: "EA không trả lời", unknown: true } satisfies TradeOutcome);
    await placeMarket("buy", "XAUUSDm", 0.1);
    expect(toastMock).toHaveBeenCalledWith("EA không trả lời", { ms: 10_000 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(refresh).toHaveBeenCalled();
  });

  it("lỗi rõ ràng (403 real...) → toast, không làm mới", async () => {
    sendOrder.mockResolvedValue({ kind: "error", status: 403, message: "Hiện chỉ giao dịch được trên account demo", unknown: false } satisfies TradeOutcome);
    await placeMarket("buy", "XAUUSDm", 0.1);
    expect(toastMock).toHaveBeenCalledWith("Hiện chỉ giao dịch được trên account demo", { ms: 7000 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("chưa có account MT5 → báo, không gửi", async () => {
    useMt5Store.setState({ accounts: [] });
    await placeMarket("buy", "XAUUSDm", 0.1);
    expect(sendOrder).not.toHaveBeenCalled();
    expect(toastMock.mock.calls[0][0]).toMatch(/account MT5/);
  });

  it("mỗi lần chỉ một lệnh: bấm lúc đang gửi bị bỏ qua, xong thì bấm tiếp được", async () => {
    let release!: (o: TradeOutcome) => void;
    sendOrder.mockReturnValueOnce(new Promise<TradeOutcome>((r) => (release = r)));
    const first = placeMarket("buy", "XAUUSDm", 0.1);
    await vi.advanceTimersByTimeAsync(0);
    expect(useOrderState.getState().busy).toBe(true);
    await placeMarket("buy", "XAUUSDm", 0.1); // bị bỏ
    expect(sendOrder).toHaveBeenCalledTimes(1);
    release(done());
    await first;
    expect(useOrderState.getState().busy).toBe(false);
    sendOrder.mockResolvedValue(done());
    await placeMarket("buy", "XAUUSDm", 0.1);
    expect(sendOrder).toHaveBeenCalledTimes(2);
  });

  it("lỗi bất ngờ vẫn nhả khoá busy", async () => {
    sendOrder.mockRejectedValue(new Error("boom"));
    await expect(placeMarket("buy", "XAUUSDm", 0.1)).rejects.toThrow("boom");
    expect(useOrderState.getState().busy).toBe(false);
  });
});

describe("closeTrade", () => {
  it("đóng hết: volume 0; toast tên symbol + ticket", async () => {
    sendClose.mockResolvedValue(done());
    await closeTrade(111, "XAUUSDm");
    expect(sendClose).toHaveBeenCalledWith("S:1", 111, 0);
    expect(toastMock.mock.calls[0][0]).toBe("Đã đóng XAUUSDm #111");
  });
  it("đóng một phần nói rõ số lot", async () => {
    sendClose.mockResolvedValue(done());
    await closeTrade(111, "XAUUSDm", 0.05);
    expect(sendClose).toHaveBeenCalledWith("S:1", 111, 0.05);
    expect(toastMock.mock.calls[0][0]).toBe("Đã đóng 0.05 lot của XAUUSDm #111");
  });
  it("cũng qua requireLogin", async () => {
    requireLogin.mockResolvedValue(false);
    await closeTrade(1, "X");
    expect(sendClose).not.toHaveBeenCalled();
  });
});

describe("newClientId", () => {
  it("hợp lệ với backend (8-32 ký tự an toàn) và không trùng", () => {
    const ids = new Set(Array.from({ length: 50 }, newClientId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{8,32}$/);
  });
  it("không có crypto.randomUUID vẫn sinh được", () => {
    vi.stubGlobal("crypto", {});
    expect(newClientId()).toMatch(/^[0-9a-f]{24}$/);
    vi.unstubAllGlobals();
  });
});
