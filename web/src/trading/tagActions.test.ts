import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mt5Account, Position } from "@/lib/mt5Api";
import { useConfirmStore } from "@/store/confirm";
import { chartGlobal } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { DEFAULT_SETTINGS, useSettingsStore } from "@/store/settings";

const { closeTrade, cancelOrder, moveStop } = vi.hoisted(() => ({ closeTrade: vi.fn(), cancelOrder: vi.fn(), moveStop: vi.fn() }));
vi.mock("./actions", () => ({ closeTrade, cancelOrder, moveStop }));
vi.mock("./submit", () => ({ submitDraft: vi.fn() }));

import type { PendingOrder } from "@/lib/mt5Api";
import { askCancelOrder, askClosePosition, askRemoveStop } from "./tagActions";

const account = { id: "S:1", name: "Test demo", broker: "B", server: "S", mode: "demo", currency: "USD", online: true, active: true } as Mt5Account;
const pos = (o: Partial<Position> = {}): Position => ({
  ticket: 7, symbol: "XAUUSDm", type: "buy", volume: 0.1, price_open: 4100.5, sl: 0, tp: 0, price_current: 4105, profit: 47.5, swap: -0.5, time: 1, magic: 0, comment: "", ...o,
});

beforeEach(() => {
  closeTrade.mockReset();
  cancelOrder.mockReset();
  moveStop.mockReset();
  useConfirmStore.setState({ request: null });
  useSettingsStore.setState({ s: { ...DEFAULT_SETTINGS } });
  useMt5Store.setState({ accounts: [account] });
  chartGlobal.setState({ symbols: [{ name: "XAUUSDm", digits: 3 } as never] });
});

describe("askClosePosition", () => {
  it("không đóng ngay: mở hộp thoại tóm tắt account, lệnh, giá vào / hiện tại, lãi/lỗi", () => {
    askClosePosition(pos());
    expect(closeTrade).not.toHaveBeenCalled();
    const r = useConfirmStore.getState().request!;
    expect(r.title).toBe("Đóng vị thế");
    expect(r.danger).toBe(true);
    expect(r.confirmLabel).toBe("Đóng vị thế");
    expect(r.rows).toEqual([
      { label: "Account", value: "Test demo · DEMO" },
      { label: "Lệnh", value: "BUY 0.10 XAUUSDm #7", tone: "buy" },
      { label: "Giá vào", value: "4100.500" },
      { label: "Giá hiện tại", value: "4105.000" },
      { label: "Lãi / Lỗ", value: "+47.00 USD", tone: "pos" },
    ]);
  });

  it("xác nhận mới gửi lệnh đóng hết (volume 0)", async () => {
    askClosePosition(pos());
    await useConfirmStore.getState().request!.onConfirm();
    expect(closeTrade).toHaveBeenCalledWith(7, "XAUUSDm", 0);
  });

  it("đóng một phần: nêu rõ phần lot sẽ đóng và gửi đúng volume", async () => {
    askClosePosition(pos(), 0.04);
    const r = useConfirmStore.getState().request!;
    expect(r.title).toBe("Đóng một phần vị thế");
    expect(r.rows).toContainEqual({ label: "Đóng", value: "0.04 / 0.10 lot" });
    await r.onConfirm();
    expect(closeTrade).toHaveBeenCalledWith(7, "XAUUSDm", 0.04);
  });

  it("volume bằng cả vị thế coi như đóng hết; lỗ tô đỏ", async () => {
    askClosePosition(pos({ type: "sell", profit: -3, swap: 0 }), 0.1);
    const r = useConfirmStore.getState().request!;
    expect(r.title).toBe("Đóng vị thế");
    expect(r.rows).toContainEqual({ label: "Lệnh", value: "SELL 0.10 XAUUSDm #7", tone: "sell" });
    expect(r.rows).toContainEqual({ label: "Lãi / Lỗ", value: "-3.00 USD", tone: "neg" });
    await r.onConfirm();
    expect(closeTrade).toHaveBeenCalledWith(7, "XAUUSDm", 0);
  });

  it("bật One-click trading trong Settings: đóng ngay, không mở hộp thoại (đóng một phần vẫn đúng volume)", () => {
    useSettingsStore.setState({ s: { ...DEFAULT_SETTINGS, oneClick: true } });
    askClosePosition(pos());
    expect(useConfirmStore.getState().request).toBeNull();
    expect(closeTrade).toHaveBeenLastCalledWith(7, "XAUUSDm", 0);
    askClosePosition(pos(), 0.04);
    expect(useConfirmStore.getState().request).toBeNull();
    expect(closeTrade).toHaveBeenLastCalledWith(7, "XAUUSDm", 0.04);
  });

  it("mặc định One-click tắt: có hỏi (đóng vị thế và sửa lệnh / SL / TP bằng kéo)", () => {
    expect(DEFAULT_SETTINGS.oneClick).toBe(false);
  });
});

const ord = (o: Partial<PendingOrder> = {}): PendingOrder => ({
  ticket: 9, symbol: "XAUUSDm", type: "buy_limit", volume: 0.01, price_open: 4069.871, price_stoplimit: 0, sl: 0, tp: 0, time_setup: 1, expiration: 0, magic: 0, comment: "", ...o,
});

describe("askCancelOrder (như hộp thoại Cancel order của TV)", () => {
  it("hỏi trước: Giữ lệnh / Huỷ lệnh, tóm tắt lệnh và giá vào; xác nhận mới huỷ", async () => {
    askCancelOrder(ord());
    expect(cancelOrder).not.toHaveBeenCalled();
    const r = useConfirmStore.getState().request!;
    expect(r.title).toBe("Huỷ lệnh chờ");
    expect(r.cancelLabel).toBe("Giữ lệnh");
    expect(r.confirmLabel).toBe("Huỷ lệnh");
    expect(r.rows).toContainEqual({ label: "Lệnh", value: "BUY LIMIT 0.01 XAUUSDm #9", tone: "buy" });
    expect(r.rows).toContainEqual({ label: "Giá vào", value: "4069.871" });
    await r.onConfirm();
    expect(cancelOrder).toHaveBeenCalledWith(9, "XAUUSDm");
  });
  it("One-click trading bật: huỷ ngay", () => {
    useSettingsStore.setState({ s: { ...DEFAULT_SETTINGS, oneClick: true } });
    askCancelOrder(ord());
    expect(useConfirmStore.getState().request).toBeNull();
    expect(cancelOrder).toHaveBeenCalledWith(9, "XAUUSDm");
  });
});

describe("askRemoveStop", () => {
  it("hỏi trước rồi mới gửi sl/tp = 0 (from = mức hiện tại để Hoàn tác)", async () => {
    askRemoveStop({ t: "position", ticket: 7 }, "tp", 4120, "XAUUSDm", 3);
    expect(moveStop).not.toHaveBeenCalled();
    const r = useConfirmStore.getState().request!;
    expect(r.title).toBe("Bỏ Take profit");
    expect(r.rows).toContainEqual({ label: "Take profit", value: "4120.000" });
    await r.onConfirm();
    expect(moveStop).toHaveBeenCalledWith({ target: "position", ticket: 7, symbol: "XAUUSDm", field: "tp", from: 4120 }, 0, 3);
  });
  it("One-click trading bật: bỏ ngay", () => {
    useSettingsStore.setState({ s: { ...DEFAULT_SETTINGS, oneClick: true } });
    askRemoveStop({ t: "order", ticket: 9 }, "sl", 4050, "XAUUSDm", 3);
    expect(useConfirmStore.getState().request).toBeNull();
    expect(moveStop).toHaveBeenCalledWith({ target: "order", ticket: 9, symbol: "XAUUSDm", field: "sl", from: 4050 }, 0, 3);
  });
});
