import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mt5Account } from "@/lib/mt5Api";
import type { TradeOutcome } from "@/lib/tradeApi";

const sendOrder = vi.fn();
const sendClose = vi.fn();
const sendPending = vi.fn();
const sendModify = vi.fn();
const sendCancel = vi.fn();
const sendModifyPos = vi.fn();
vi.mock("@/lib/tradeApi", () => ({
  sendMarketOrder: (...a: unknown[]) => sendOrder(...a),
  sendClosePosition: (...a: unknown[]) => sendClose(...a),
  sendPendingOrder: (...a: unknown[]) => sendPending(...a),
  sendModifyOrder: (...a: unknown[]) => sendModify(...a),
  sendCancelOrder: (...a: unknown[]) => sendCancel(...a),
  sendModifyPosition: (...a: unknown[]) => sendModifyPos(...a),
}));
const requireLogin = vi.fn();
vi.mock("@/store/auth", () => ({ useAuthStore: { getState: () => ({ requireLogin }) } }));
const toastMock = vi.fn();
vi.mock("@/store/toast", () => ({ toast: (...a: unknown[]) => toastMock(...a) }));
const refresh = vi.fn();
vi.mock("./store", () => ({ useTradeStore: { getState: () => ({ refresh }) } }));

import { useMt5Store } from "@/store/mt5";
import type { PendingOrder } from "@/lib/mt5Api";
import { cancelOrder, closeTrade, moveOrder, moveStop, moveStops, newClientId, placeMarket, placePending, useOrderState } from "./actions";
import { useQuoteStore } from "./quote";

const acc = { id: "S:1", server: "S", mode: "demo", online: true, active: true } as Mt5Account;
const done = (o: Partial<{ ok: boolean; message: string; price: number; orderType: string; typeChanged: boolean }> = {}): TradeOutcome => ({
  kind: "done", result: { ok: true, message: "", retcode: 10009, order: 1, deal: 2, price: 4131.25, volume: 0.1, orderType: "", typeChanged: false, ...o },
});

beforeEach(() => {
  vi.useFakeTimers();
  for (const m of [sendOrder, sendClose, sendPending, sendModify, sendCancel, sendModifyPos, requireLogin, toastMock, refresh]) m.mockReset();
  useQuoteStore.setState({ quotes: { XAUUSDm: { bid: 4130, ask: 4130.2 } } });
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
    expect(toastMock).toHaveBeenCalledWith("EA không trả lời", expect.objectContaining({ ms: 10_000, kind: "error" }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(refresh).toHaveBeenCalled();
  });

  it("lỗi rõ ràng (403 real...) → toast, không làm mới", async () => {
    sendOrder.mockResolvedValue({ kind: "error", status: 403, message: "Hiện chỉ giao dịch được trên account demo", unknown: false } satisfies TradeOutcome);
    await placeMarket("buy", "XAUUSDm", 0.1);
    expect(toastMock).toHaveBeenCalledWith("Hiện chỉ giao dịch được trên account demo", expect.objectContaining({ ms: 7000, kind: "error" }));
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

const ord = (o: Partial<PendingOrder> = {}) =>
  ({ ticket: 222, symbol: "XAUUSDm", type: "buy_limit", volume: 0.2, price_open: 4120, price_stoplimit: 0, sl: 4110, tp: 4150, time_setup: 1, expiration: 0, magic: 0, comment: "", ...o }) as PendingOrder;

describe("placePending", () => {
  const req = { symbol: "XAUUSDm", side: "buy" as const, volume: 0.1, price: 4120, sl: 4110, tp: 4140, expectedType: "buy_limit" as const };

  it("gửi ý định (hướng + giá) cùng loại web đang hiển thị, mỗi lần một client_id", async () => {
    sendPending.mockResolvedValue(done({ orderType: "buy_limit" }));
    expect(await placePending(req, 3)).toBe(true);
    await placePending(req, 3);
    const [id, o1] = sendPending.mock.calls[0];
    expect(id).toBe("S:1");
    expect(o1).toMatchObject({ symbol: "XAUUSDm", side: "buy", volume: 0.1, price: 4120, sl: 4110, tp: 4140, expectedType: "buy_limit" });
    expect(o1.clientId).not.toBe(sendPending.mock.calls[1][1].clientId);
    expect(toastMock.mock.calls[0][0]).toBe("Buy limit 0.10 XAUUSDm @ 4120.000");
  });

  it("giá nhảy làm EA chọn loại khác: vẫn đặt (demo) nhưng toast nói rõ", async () => {
    sendPending.mockResolvedValue(done({ orderType: "buy_stop", typeChanged: true }));
    expect(await placePending(req, 3)).toBe(true);
    expect(toastMock.mock.calls[0][0]).toMatch(/^Đã đặt Buy stop 0\.10 XAUUSDm @ 4120\.000 \(giá nhảy/);
  });

  it("sàn từ chối → toast message, trả false", async () => {
    sendPending.mockResolvedValue(done({ ok: false, message: "Giá vào quá gần giá thị trường (tối thiểu 30 điểm)" }));
    expect(await placePending(req)).toBe(false);
    expect(toastMock.mock.calls[0][0]).toMatch(/tối thiểu 30/);
  });

  it("khách đóng popup đăng nhập → không gửi, false", async () => {
    requireLogin.mockResolvedValue(false);
    expect(await placePending(req)).toBe(false);
    expect(sendPending).not.toHaveBeenCalled();
  });
});

describe("cancelOrder", () => {
  it("gọi huỷ đúng ticket và báo", async () => {
    sendCancel.mockResolvedValue(done());
    expect(await cancelOrder(222, "XAUUSDm")).toBe(true);
    expect(sendCancel).toHaveBeenCalledWith("S:1", 222);
    expect(toastMock.mock.calls[0][0]).toBe("Đã huỷ lệnh chờ XAUUSDm #222");
  });
  it("lỗi → false", async () => {
    sendCancel.mockResolvedValue(done({ ok: false, message: "Không còn lệnh chờ này" }));
    expect(await cancelOrder(222, "XAUUSDm")).toBe(false);
  });
});

describe("moveOrder", () => {
  it("cùng loại (vẫn dưới Ask) → chỉ sửa giá", async () => {
    sendModify.mockResolvedValue(done());
    expect(await moveOrder(ord(), 4115.5, 3)).toBe(true);
    expect(sendModify).toHaveBeenCalledWith("S:1", 222, { price: 4115.5 });
    expect(sendPending).not.toHaveBeenCalled();
    expect(sendCancel).not.toHaveBeenCalled();
    expect(toastMock.mock.calls[0][0]).toBe("Đã đổi giá XAUUSDm #222 → 4115.500");
  });

  it("kéo qua giá thị trường: ĐẶT LỆNH MỚI đúng loại TRƯỚC, rồi mới xoá lệnh cũ, mang theo lot/SL/TP/hết hạn", async () => {
    const order: string[] = [];
    sendPending.mockImplementation(async () => (order.push("place"), done({ orderType: "buy_stop" })));
    sendCancel.mockImplementation(async () => (order.push("cancel"), done()));
    expect(await moveOrder(ord({ expiration: 1_900_000_000 }), 4150, 3)).toBe(true); // Buy Limit kéo lên trên Ask → Buy Stop
    expect(order).toEqual(["place", "cancel"]);
    expect(sendModify).not.toHaveBeenCalled();
    expect(sendPending.mock.calls[0][1]).toMatchObject({ symbol: "XAUUSDm", side: "buy", volume: 0.2, price: 4150, sl: 4110, tp: 4150, expiration: 1_900_000_000, expectedType: "buy_stop" });
    expect(sendCancel).toHaveBeenCalledWith("S:1", 222);
    expect(toastMock).toHaveBeenCalledTimes(1); // một toast tổng kết, không hai
    expect(toastMock.mock.calls[0][0]).toMatch(/Đã chuyển lệnh #222 thành Buy stop 0\.20 XAUUSDm @ 4150\.000/);
  });

  it("đặt lệnh mới lỗi → giữ nguyên lệnh cũ (không xoá), trả false", async () => {
    sendPending.mockResolvedValue(done({ ok: false, message: "SL/TP không hợp lệ (quá gần giá)" }));
    expect(await moveOrder(ord(), 4150, 3)).toBe(false);
    expect(sendCancel).not.toHaveBeenCalled();
    expect(toastMock.mock.calls[0][0]).toMatch(/SL\/TP/);
  });

  it("đặt mới được nhưng xoá cũ lỗi → cảnh báo to rõ để người dùng xoá tay", async () => {
    sendPending.mockResolvedValue(done({ orderType: "buy_stop" }));
    sendCancel.mockResolvedValue({ kind: "error", status: 504, message: "EA không trả lời", unknown: true } satisfies TradeOutcome);
    expect(await moveOrder(ord(), 4150, 3)).toBe(true);
    expect(toastMock).toHaveBeenLastCalledWith(expect.stringMatching(/chưa xoá được lệnh cũ #222/), expect.objectContaining({ ms: 12_000, kind: "error" }));
  });

  it("sell stop kéo lên trên Bid → sell limit mới", async () => {
    sendPending.mockResolvedValue(done({ orderType: "sell_limit" }));
    sendCancel.mockResolvedValue(done());
    await moveOrder(ord({ type: "sell_stop", price_open: 4100 }), 4160, 3);
    expect(sendPending.mock.calls[0][1]).toMatchObject({ side: "sell", price: 4160, expectedType: "sell_limit" });
  });

  it("đúng giá thị trường → báo, không gọi gì", async () => {
    expect(await moveOrder(ord(), 4130.2, 3)).toBe(false);
    expect(sendModify).not.toHaveBeenCalled();
    expect(sendPending).not.toHaveBeenCalled();
    expect(toastMock.mock.calls[0][0]).toMatch(/trùng giá thị trường/);
  });

  it("chưa có giá thị trường → gửi sửa giá, để EA quyết (EA từ chối nếu loại sẽ đổi)", async () => {
    useQuoteStore.setState({ quotes: {} });
    sendModify.mockResolvedValue(done({ ok: false, message: "Giá mới đã vượt qua giá thị trường nên đổi loại lệnh (nay là Buy stop)" }));
    expect(await moveOrder(ord(), 4150, 3)).toBe(false);
    expect(sendModify).toHaveBeenCalledWith("S:1", 222, { price: 4150 });
  });

  it("lệnh stop-limit (không hỗ trợ) → sửa giá thẳng, không đoán loại", async () => {
    sendModify.mockResolvedValue(done());
    await moveOrder(ord({ type: "buy_stop_limit" }), 4150, 3);
    expect(sendModify).toHaveBeenCalled();
    expect(sendPending).not.toHaveBeenCalled();
  });
});

describe("moveOrder kèm SL/TP", () => {
  it("cùng loại: giá + SL + TP đi chung MỘT yêu cầu sửa lệnh", async () => {
    sendModify.mockResolvedValue(done());
    expect(await moveOrder(ord(), 4115.5, 3, { sl: 4100, tp: 4160 })).toBe(true);
    expect(sendModify).toHaveBeenCalledOnce();
    expect(sendModify).toHaveBeenCalledWith("S:1", 222, { price: 4115.5, sl: 4100, tp: 4160 });
  });
  it("đổi loại (đặt lệnh mới): mang theo SL/TP mới, mức không đổi thì giữ của lệnh cũ", async () => {
    sendPending.mockResolvedValue(done({ orderType: "buy_stop" }));
    sendCancel.mockResolvedValue(done());
    await moveOrder(ord(), 4150, 3, { sl: 4120 });
    expect(sendPending.mock.calls[0][1]).toMatchObject({ price: 4150, sl: 4120, tp: 4150 });
  });
});

describe("moveStops", () => {
  const t = { target: "position" as const, ticket: 111, symbol: "XAUUSDm" };
  const both = [
    { field: "sl" as const, from: 4115, to: 4118.5 },
    { field: "tp" as const, from: 4140, to: 4150 },
  ];

  it("SL và TP đổi cùng lúc: MỘT yêu cầu mang cả hai trường (backend ghép trường vắng với số liệu cũ nên hai yêu cầu sẽ đè nhau)", async () => {
    sendModifyPos.mockResolvedValue(done());
    expect(await moveStops(t, both, 3)).toBe(true);
    expect(sendModifyPos).toHaveBeenCalledOnce();
    expect(sendModifyPos).toHaveBeenCalledWith("S:1", 111, { sl: 4118.5, tp: 4150 });
    const [text, opts] = toastMock.mock.calls[0];
    expect(text).toBe("Đã đổi SL & TP XAUUSDm #111: SL → 4118.500, TP → 4150.000");
    expect(opts.action.label).toBe("Hoàn tác");
  });

  it("cả hai mức đều mới (kéo nút TP/SL mờ ra): toast nói đặt, không phải đổi; Hoàn tác = bỏ cả hai", async () => {
    sendModifyPos.mockResolvedValue(done());
    await moveStops(t, [{ field: "sl", from: 0, to: 4100 }, { field: "tp", from: 0, to: 4150 }], 3);
    expect(toastMock.mock.calls[0][0]).toBe("Đã đặt SL & TP XAUUSDm #111: SL → 4100.000, TP → 4150.000");
    toastMock.mock.calls[0][1].action.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendModifyPos).toHaveBeenLastCalledWith("S:1", 111, { sl: 0, tp: 0 });
  });

  it("Hoàn tác trả cả hai mức về giá cũ trong một yêu cầu", async () => {
    sendModifyPos.mockResolvedValue(done());
    await moveStops(t, both, 3);
    toastMock.mock.calls[0][1].action.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendModifyPos).toHaveBeenLastCalledWith("S:1", 111, { sl: 4115, tp: 4140 });
    expect(toastMock).toHaveBeenLastCalledWith("Đã hoàn tác SL & TP XAUUSDm #111", expect.objectContaining({ ms: 4000, kind: "success" }));
  });

  it("lệnh chờ: đi qua API sửa lệnh; một mức bỏ (to = 0) được ghi là bỏ", async () => {
    sendModify.mockResolvedValue(done());
    await moveStops({ target: "order", ticket: 222, symbol: "XAUUSDm" }, [{ field: "sl", from: 4100, to: 0 }, { field: "tp", from: 4150, to: 4160 }], 3);
    expect(sendModify).toHaveBeenCalledWith("S:1", 222, { sl: 0, tp: 4160 });
    expect(toastMock.mock.calls[0][0]).toBe("Đã đổi SL & TP XAUUSDm #222: bỏ SL, TP → 4160.000");
  });

  it("không có thay đổi nào → không gửi gì", async () => {
    expect(await moveStops(t, [], 3)).toBe(false);
    expect(sendModifyPos).not.toHaveBeenCalled();
  });

  it("sàn từ chối → một toast lỗi, không có Hoàn tác, false", async () => {
    sendModifyPos.mockResolvedValue(done({ ok: false, message: "SL/TP không hợp lệ (quá gần giá)" }));
    expect(await moveStops(t, both, 3)).toBe(false);
    expect(toastMock.mock.calls).toEqual([["SL/TP không hợp lệ (quá gần giá)", expect.objectContaining({ ms: 7000, kind: "error" })]]);
  });
});

describe("moveStop", () => {
  const pos = { target: "position" as const, ticket: 111, symbol: "XAUUSDm", field: "sl" as const, from: 4115 };

  it("vị thế: đổi đúng trường qua API vị thế, toast kèm lãi/lỗi và nút Hoàn tác", async () => {
    sendModifyPos.mockResolvedValue(done());
    expect(await moveStop(pos, 4118.5, 3, " (-35.00 USD)")).toBe(true);
    expect(sendModifyPos).toHaveBeenCalledWith("S:1", 111, { sl: 4118.5 });
    expect(sendModify).not.toHaveBeenCalled();
    const [text, opts] = toastMock.mock.calls[0];
    expect(text).toBe("Đã đổi SL XAUUSDm #111 → 4118.500 (-35.00 USD)");
    expect(opts.action.label).toBe("Hoàn tác");
  });

  it("lệnh chờ: dùng API sửa lệnh với trường tp", async () => {
    sendModify.mockResolvedValue(done());
    await moveStop({ target: "order", ticket: 222, symbol: "XAUUSDm", field: "tp", from: 4150 }, 4160, 3);
    expect(sendModify).toHaveBeenCalledWith("S:1", 222, { tp: 4160 });
    expect(sendModifyPos).not.toHaveBeenCalled();
    expect(toastMock.mock.calls[0][0]).toBe("Đã đổi TP XAUUSDm #222 → 4160.000");
  });

  it("Hoàn tác đặt lại mức cũ", async () => {
    sendModifyPos.mockResolvedValue(done());
    await moveStop(pos, 4118.5, 3);
    toastMock.mock.calls[0][1].action.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendModifyPos).toHaveBeenLastCalledWith("S:1", 111, { sl: 4115 });
    expect(toastMock).toHaveBeenLastCalledWith("Đã hoàn tác SL XAUUSDm #111 → 4115.000", expect.objectContaining({ ms: 4000, kind: "success" }));
  });

  it("sàn từ chối → toast message, không có nút Hoàn tác, trả false", async () => {
    sendModifyPos.mockResolvedValue(done({ ok: false, message: "SL/TP không hợp lệ (quá gần giá)" }));
    expect(await moveStop(pos, 4129.9, 3)).toBe(false);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0]).toEqual(["SL/TP không hợp lệ (quá gần giá)", expect.objectContaining({ ms: 7000, kind: "error" })]);
  });

  it("EA cũ (409 cần >= 2.14) → báo rõ, false", async () => {
    sendModifyPos.mockResolvedValue({ kind: "error", status: 409, message: "Đổi SL/TP vị thế cần EA TVBridge >= 2.14", unknown: false } satisfies TradeOutcome);
    expect(await moveStop(pos, 4118, 3)).toBe(false);
    expect(toastMock.mock.calls[0][0]).toMatch(/2\.14/);
  });

  it("chưa đăng nhập → không gửi", async () => {
    requireLogin.mockResolvedValue(false);
    expect(await moveStop(pos, 4118, 3)).toBe(false);
    expect(sendModifyPos).not.toHaveBeenCalled();
  });
  it("đặt mới (kéo nút TP/SL mờ ra): toast nói đặt (không phải đổi), Hoàn tác = bỏ mức vừa đặt", async () => {
    sendModifyPos.mockResolvedValue(done());
    await moveStop({ ...pos, from: 0 }, 4118.5, 3);
    expect(sendModifyPos).toHaveBeenCalledWith("S:1", 111, { sl: 4118.5 });
    expect(toastMock.mock.calls[0][0]).toBe("Đã đặt SL XAUUSDm #111 → 4118.500");
    toastMock.mock.calls[0][1].action.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendModifyPos).toHaveBeenLastCalledWith("S:1", 111, { sl: 0 });
    expect(toastMock).toHaveBeenLastCalledWith("Đã bỏ SL XAUUSDm #111", expect.objectContaining({ ms: 4000, kind: "success" }));
  });

  it("giá 0 = bỏ SL/TP (dấu × trên thẻ): gửi 0, Hoàn tác đặt lại mức cũ", async () => {
    sendModifyPos.mockResolvedValue(done());
    expect(await moveStop(pos, 0, 3)).toBe(true);
    expect(sendModifyPos).toHaveBeenCalledWith("S:1", 111, { sl: 0 });
    expect(toastMock.mock.calls[0][0]).toBe("Đã bỏ SL XAUUSDm #111");
    toastMock.mock.calls[0][1].action.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendModifyPos).toHaveBeenLastCalledWith("S:1", 111, { sl: 4115 });
  });
});
