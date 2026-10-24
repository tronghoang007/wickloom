import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mt5Account, PendingOrder, Position } from "@/lib/mt5Api";
import type { DragPreview } from "./format";

const h = vi.hoisted(() => ({ host: null as null | Record<string, (...a: never[]) => unknown>, moveStops: vi.fn(), moveOrder: vi.fn(), begin: vi.fn() }));
vi.mock("./lineDrag", () => ({
  LineDrag: class {
    constructor(host: Record<string, (...a: never[]) => unknown>) {
      h.host = host;
    }
    destroy() {}
    begin(...a: unknown[]) {
      h.begin(...a);
    }
  },
}));
vi.mock("./actions", () => ({ moveStops: h.moveStops, moveOrder: h.moveOrder }));
vi.mock("@/store/toast", () => ({ toast: vi.fn() }));

import { useAuthStore } from "@/store/auth";
import { chartGlobal } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { useRailStore } from "@/store/rail";
import { DEFAULT_SETTINGS, useSettingsStore } from "@/store/settings";
import { createLineDrag, type ChartDrag } from "./chartOrders";
import { useTradeFocus } from "./focus";
import { useQuoteStore } from "./quote";
import { clearEdit, seedEditStop, setEditPrice } from "./editBridge";
import { useReplaySim } from "./replaySim";
import type { PnlSpec } from "./pnl";
import { useTradeStore } from "./store";
import { useTicketStore } from "./ticket";

const account = { id: "S:1", server: "S", broker: "B", login: 1, name: "n", mode: "demo", currency: "USD", leverage: 500, online: true, active: true, seen: 1, ea_trading: true } as Mt5Account;
const position: Position = { ticket: 1, symbol: "XAUUSDm", type: "buy", volume: 0.1, price_open: 4125, sl: 4090, tp: 4150, price_current: 4130, profit: 0, swap: 0, time: 1, magic: 0, comment: "" };
const order: PendingOrder = { ticket: 2, symbol: "XAUUSDm", type: "buy_limit", volume: 0.2, price_open: 4100, price_stoplimit: 0, sl: 4080, tp: 4160, time_setup: 1, expiration: 0, magic: 0, comment: "" };

const call = (name: string, ...args: unknown[]) => (h.host![name] as (...a: unknown[]) => unknown)(...args);
const drop = (id: string, price: number) => {
  call("onMove", id, price);
  call("onDrop", id, price, 0);
};

let previews: DragPreview[][];
let keydown: ((e: { key: string }) => void) | null;
let ctl: ChartDrag;
let clickHandler: (() => void) | null;
let replayOn = false;

beforeEach(() => {
  vi.useFakeTimers();
  h.host = null;
  h.moveStops.mockReset().mockResolvedValue(true);
  h.moveOrder.mockReset().mockResolvedValue(true);
  keydown = null;
  vi.stubGlobal("window", { addEventListener: (t: string, f: (e: { key: string }) => void) => t === "keydown" && (keydown = f), removeEventListener: vi.fn() });
  useAuthStore.setState({ status: "user" });
  useMt5Store.setState({ accounts: [account], loaded: true });
  useQuoteStore.setState({ quotes: { XAUUSDm: { bid: 4130, ask: 4130.2 } } });
  chartGlobal.setState({ symbols: [{ name: "XAUUSDm", digits: 3, tick_size: 0.001 } as never] });
  useSettingsStore.setState({ s: { ...DEFAULT_SETTINGS, oneClick: false } });
  useTradeStore.setState({ data: { account, positions: [position], orders: [order], deals: [], updated_at: Date.now() / 1000 } });
  previews = [];
  clickHandler = null;
  replayOn = false;
  h.begin.mockReset();
  useReplaySim.setState({ byPane: {} });
  useTradeFocus.setState({ owner: null });
  ctl = createLineDrag({
    chart: { subscribeClick: (f: () => void) => (clickHandler = f), unsubscribeClick: vi.fn() } as never,
    container: {} as never,
    listenOn: {} as never,
    getSeries: () => null,
    getSymbol: () => "XAUUSDm",
    getDigits: () => 3,
    isReplay: () => replayOn,
    paneId: "p1",
    setPreview: (p) => previews.push(p),
  });
});
afterEach(() => {
  ctl.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const last = () => previews[previews.length - 1];

describe("Discard", () => {
  it("bỏ thay đổi chờ và bỏ chọn lệnh đó (focus + bảng Modify)", () => {
    useTicketStore.getState().select("position:1");
    drop("psl:1", 4100);
    ctl.cancelEdit("position:1");
    expect(last()).toEqual([]);
    expect(useTradeFocus.getState().owner).toBeNull();
    expect(useTicketStore.getState().modifyOwner).toBeNull();
    expect(useRailStore.getState().open).not.toBe("order"); // thanh trả về panel trước đó
    call("onMove", "psl:1", 4095); // chọn -> kéo -> Discard -> kéo: cú kéo sau KHÔNG dựng lại bảng như vừa bấm chọn
    expect(useTicketStore.getState().modifyOwner).toBeNull();
    expect(useRailStore.getState().open).not.toBe("order");
  });

  it("Discard của lệnh này không bỏ chọn lệnh khác đang focus", () => {
    drop("psl:1", 4100);
    useTradeFocus.setState({ owner: "order:2" });
    ctl.cancelEdit("position:1");
    expect(useTradeFocus.getState().owner).toBe("order:2");
  });
});

describe("ô nhập ở bảng Modify (editBridge)", () => {
  it("nhập giá = thay đổi chờ xác nhận; One-click bật cũng không tự gửi (có nút Modify)", () => {
    useSettingsStore.setState({ s: { ...DEFAULT_SETTINGS, oneClick: true } });
    setEditPrice("psl:1", 4100);
    expect(last().map((p) => [p.key, p.price, p.pending])).toEqual([["psl:1", 4100, true]]);
    expect(h.moveStops).not.toHaveBeenCalled();
  });

  it("giá sai phía thì không tạo thay đổi chờ", () => {
    setEditPrice("psl:1", 4200); // SL của vị thế Buy phải dưới giá thị trường
    expect(last()).toEqual([]);
  });

  it("bật SL / TP chưa có: mức gợi ý đúng phía; clear bỏ thay đổi chờ", () => {
    seedEditStop("ptp:1");
    const [tp] = last();
    expect(tp.key).toBe("ptp:1");
    clearEdit("ptp:1");
    expect(last()).toEqual([]);
  });
});

describe("kéo SL / TP của vị thế (One-click tắt)", () => {
  it("kéo TP sau khi đã thả SL: cả hai cùng chờ xác nhận, SL KHÔNG bị trả về giá cũ", () => {
    drop("psl:1", 4100);
    drop("ptp:1", 4170);
    expect(last().map((p) => [p.key, p.price, p.pending])).toEqual([["psl:1", 4100, true], ["ptp:1", 4170, true]]);
    expect(h.moveStops).not.toHaveBeenCalled();
  });

  it("đang kéo một đường thì các đường đã chờ vẫn hiện, đường đang kéo đè lên cùng khoá", () => {
    drop("psl:1", 4100);
    call("onMove", "ptp:1", 4160);
    expect(last().map((p) => [p.key, p.price, p.pending])).toEqual([["psl:1", 4100, true], ["ptp:1", 4160, undefined]]);
    call("onMove", "psl:1", 4095); // kéo lại chính SL: bản đang kéo đứng SAU bản đang chờ nên thắng (tradeLines lấy bản cuối của mỗi khoá)
    expect(last().filter((p) => p.key === "psl:1").map((p) => p.price)).toEqual([4100, 4095]);
  });

  it("Confirm gửi MỘT yêu cầu có cả SL và TP, kèm mức cũ để Hoàn tác", async () => {
    drop("psl:1", 4100);
    drop("ptp:1", 4170);
    ctl.confirmEdit("position:1");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.moveStops).toHaveBeenCalledOnce();
    expect(h.moveStops.mock.calls[0][0]).toEqual({ target: "position", symbol: "XAUUSDm", ticket: 1 });
    expect(h.moveStops.mock.calls[0][1]).toEqual([
      { field: "sl", from: 4090, to: 4100 },
      { field: "tp", from: 4150, to: 4170 },
    ]);
    expect(last().every((p) => !p.pending)).toBe(true); // đã gửi: giữ giá mới tới khi EA báo
    await vi.advanceTimersByTimeAsync(1500);
    expect(last()).toEqual([]);
  });

  it("gửi lỗi thì các đường trả về giá thật ngay", async () => {
    h.moveStops.mockResolvedValue(false);
    drop("psl:1", 4100);
    ctl.confirmEdit("position:1");
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toEqual([]);
  });

  it("Discard của một chủ chỉ bỏ thay đổi của chủ đó", () => {
    drop("psl:1", 4100);
    drop("osl:2", 4070);
    ctl.cancelEdit("position:1");
    expect(last().map((p) => p.key)).toEqual(["osl:2"]);
  });

  it("Esc bỏ mọi thay đổi đang chờ; Esc lúc đang kéo chỉ huỷ cú kéo (LineDrag lo), không bỏ cái đã thả", () => {
    drop("psl:1", 4100);
    call("onMove", "ptp:1", 4160); // đang kéo
    keydown!({ key: "Escape" });
    expect(last().map((p) => p.key)).toEqual(["psl:1", "ptp:1"]);
    call("onAbort", "ptp:1", 4150);
    expect(last().map((p) => p.key)).toEqual(["psl:1"]);
    keydown!({ key: "Escape" });
    expect(last()).toEqual([]);
  });

  it("thả sai phía (SL cao hơn giá thị trường của lệnh Buy) → bị từ chối, không chờ gì", () => {
    drop("psl:1", 4140);
    expect(last()).toEqual([]);
  });

  it("One-click bật: thả là gửi ngay, không có bước chờ", async () => {
    useSettingsStore.setState({ s: { ...DEFAULT_SETTINGS, oneClick: true } });
    drop("psl:1", 4100);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.moveStops).toHaveBeenCalledOnce();
    expect(h.moveStops.mock.calls[0][1]).toEqual([{ field: "sl", from: 4090, to: 4100 }]);
    expect(previews.some((p) => p.some((x) => x.pending))).toBe(false);
  });
});

describe("kéo lệnh chờ cùng SL/TP của nó", () => {
  it("giá vào + SL + TP: một lần moveOrder mang cả SL/TP, không gọi moveStops riêng", async () => {
    drop("o:2", 4105);
    drop("osl:2", 4075);
    ctl.confirmEdit("order:2");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.moveStops).not.toHaveBeenCalled();
    expect(h.moveOrder).toHaveBeenCalledOnce();
    expect(h.moveOrder.mock.calls[0][0]).toMatchObject({ ticket: 2 });
    expect(h.moveOrder.mock.calls[0][1]).toBe(4105);
    expect(h.moveOrder.mock.calls[0][3]).toEqual({ sl: 4075 });
  });

  it("chỉ SL + TP (không đụng giá vào): đi qua moveStops", async () => {
    drop("osl:2", 4075);
    drop("otp:2", 4170);
    ctl.confirmEdit("order:2");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.moveStops.mock.calls[0][0]).toEqual({ target: "order", symbol: "XAUUSDm", ticket: 2 });
    expect(h.moveStops.mock.calls[0][1]).toEqual([
      { field: "sl", from: 4080, to: 4075 },
      { field: "tp", from: 4160, to: 4170 },
    ]);
  });
});

describe("focus lệnh trên chart", () => {
  it("kéo một đường SL = focus vị thế chứa nó; lệnh chờ và bản nháp có khoá riêng", () => {
    call("onMove", "psl:1", 4100);
    expect(useTradeFocus.getState().owner).toBe("position:1");
    call("onMove", "otp:2", 4170);
    expect(useTradeFocus.getState().owner).toBe("order:2");
    call("onMove", "d:sl", 4100);
    expect(useTradeFocus.getState().owner).toBe("draft");
  });

  it("bấm vào đường mà không kéo (onAbort) cũng focus", () => {
    call("onAbort", "ptp:1", 4150, true);
    expect(useTradeFocus.getState().owner).toBe("position:1");
  });

  it("chỉ bấm không dời mới chọn lệnh (mở bảng Modify); kéo rồi thả lại giá cũ hay Esc thì chỉ focus", () => {
    useRailStore.setState({ open: null }); // thanh đang đóng: kéo không được tự mở / đổi bảng
    useTicketStore.setState({ modifyOwner: null });
    call("onAbort", "ptp:1", 4150, false);
    expect(useTicketStore.getState().modifyOwner).toBeNull();
    expect(useTradeFocus.getState().owner).toBe("position:1");
    call("onAbort", "ptp:1", 4150, true);
    expect(useTicketStore.getState().modifyOwner).toBe("position:1");
  });

  it("bấm nền chart hoặc Esc thì bỏ focus; Esc lúc đang kéo thì không", () => {
    useTradeFocus.setState({ owner: "position:1" });
    clickHandler!();
    expect(useTradeFocus.getState().owner).toBeNull();
    useTradeFocus.setState({ owner: "position:1" });
    call("onMove", "psl:1", 4100);
    keydown!({ key: "Escape" });
    expect(useTradeFocus.getState().owner).toBe("position:1");
    call("onAbort", "psl:1", 4090);
    keydown!({ key: "Escape" });
    expect(useTradeFocus.getState().owner).toBeNull();
  });
});

describe("Replay: SL / TP của vị thế giả lập", () => {
  const spec: PnlSpec = { tickSize: 0.001, tickValue: 0.1, tickValueLoss: 0.1 };
  const targets = () => (h.host!.getTargets as () => { id: string; price: number }[])();
  const sim = () => useReplaySim.getState().byPane.p1.position;
  beforeEach(() => {
    replayOn = true;
    const st = useReplaySim.getState();
    st.ingest("p1", "XAUUSDm", { t: 1000, h: 4100, l: 4100, c: 4100 });
    st.order("p1", "buy", 0.1, spec);
  });

  it("đang Replay: không kéo được lệnh thật, chỉ SL / TP giả lập đã đặt", () => {
    expect(targets()).toEqual([]);
    useReplaySim.getState().setStop("p1", "sl", 4090);
    useReplaySim.getState().setStop("p1", "tp", 4120);
    expect(targets()).toEqual([{ id: "ssl:-1", price: 4090 }, { id: "stp:-1", price: 4120 }]);
  });

  it("kéo đường: áp thẳng vào vị thế giả lập (không qua bước xác nhận); mức sai phía bị bỏ qua", () => {
    useReplaySim.getState().setStop("p1", "sl", 4090);
    call("onMove", "ssl:-1", 4085);
    expect(sim()?.sl).toBe(4085);
    call("onMove", "ssl:-1", 4110); // trên giá hiện tại: không hợp lệ cho SL của Buy
    expect(sim()?.sl).toBe(4085);
    call("onDrop", "ssl:-1", 4085, 4090);
    expect(previews.flat()).toEqual([]); // không có xem trước / chờ xác nhận kiểu lệnh thật
  });

  it("Esc / thả không dời: về mức cũ; đường vừa kéo ra từ nút mờ (mức cũ 0) thì bị bỏ", () => {
    useReplaySim.getState().setStop("p1", "tp", 4120);
    call("onMove", "stp:-1", 4130);
    call("onAbort", "stp:-1", 4120);
    expect(sim()?.tp).toBe(4120);
    call("onAbort", "stp:-1", 0);
    expect(sim()?.tp).toBe(0);
  });

  it("kéo nút TP / SL mờ trên thẻ: nhấn chưa đặt gì, chỉ khi bắt đầu kéo mới đặt mức gợi ý theo giá nến hiện tại", () => {
    ctl.beginStop({ t: "position", ticket: -1 }, "tp", {} as never);
    expect(sim()?.tp).toBe(0);
    const arm = h.begin.mock.calls[0][4] as () => boolean;
    expect(h.begin).toHaveBeenCalledWith({}, "stp:-1", 0, expect.any(Number), expect.any(Function));
    expect(arm()).toBe(true);
    expect(sim()?.tp).toBeGreaterThan(4100);
    ctl.beginStop({ t: "position", ticket: -1 }, "sl", {} as never);
    expect(sim()?.sl).toBe(0);
    (h.begin.mock.calls[1][4] as () => boolean)();
    expect(sim()?.sl).toBeLessThan(4100);
    expect(sim()?.sl).toBeGreaterThan(0);
  });

  it("chưa có vị thế giả lập: nút mờ không làm gì", () => {
    useReplaySim.setState({ byPane: {} });
    ctl.beginStop({ t: "position", ticket: -1 }, "sl", {} as never);
    expect(h.begin).not.toHaveBeenCalled();
  });
});
