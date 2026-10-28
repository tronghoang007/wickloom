import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mt5Account, PendingOrder, Position } from "@/lib/mt5Api";
import type { DragPreview } from "./format";

const h = vi.hoisted(() => ({ host: null as null | Record<string, (...a: never[]) => unknown>, moveStops: vi.fn(), moveOrder: vi.fn(), begin: vi.fn(), tapped: false }));
vi.mock("./lineDrag", () => ({
  LineDrag: class {
    constructor(host: Record<string, (...a: never[]) => unknown>) {
      h.host = host;
    }
    destroy() {}
    consumeTap() {
      return h.tapped;
    }
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
import { SIM_ACCOUNT_ID } from "./simId";
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
  h.tapped = false;
  h.moveStops.mockReset().mockResolvedValue(true);
  h.moveOrder.mockReset().mockResolvedValue(true);
  keydown = null;
  vi.stubGlobal("window", { addEventListener: (t: string, f: (e: { key: string }) => void) => t === "keydown" && (keydown = f), removeEventListener: vi.fn() });
  useAuthStore.setState({ status: "user" });
  useMt5Store.setState({ accounts: [account], loaded: true });
  useQuoteStore.setState({ quotes: { XAUUSDm: { bid: 4130, ask: 4130.2 } } });
  chartGlobal.setState({ symbols: [{ name: "XAUUSDm", digits: 3, tick_size: 0.001 } as never] });
  useSettingsStore.setState({ s: { ...DEFAULT_SETTINGS, oneClick: false } });
  useTradeStore.setState({ sim: false, data: { account, positions: [position], orders: [order], deals: [], updated_at: Date.now() / 1000 } });
  previews = [];
  clickHandler = null;
  replayOn = false;
  h.begin.mockReset();
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

describe("bấm vào đường để chọn lệnh (hai thẻ đè nhau không bấm trúng được)", () => {
  type T = { id: string; price: number; fixed?: boolean };
  const targets = () => (h.host!.getTargets as () => T[])();
  const byId = (id: string) => targets().find((t) => t.id === id);

  it("giá vào của vị thế là đường chỉ-bấm (không kéo được); giá vào lệnh chờ, SL, TP vẫn kéo được", () => {
    expect(byId("p:1")).toEqual({ id: "p:1", price: 4125, fixed: true });
    expect(byId("o:2")?.fixed).toBeUndefined();
    for (const id of ["psl:1", "ptp:1", "osl:2", "otp:2"]) expect(byId(id)?.fixed).toBeUndefined();
  });

  it("bấm đường giá vào của vị thế (onAbort click) = chọn vị thế, mở bảng Modify", () => {
    useTicketStore.setState({ modifyOwner: null });
    call("onAbort", "p:1", 4125, true);
    expect(useTicketStore.getState().modifyOwner).toBe("position:1");
    expect(useTradeFocus.getState().owner).toBe("position:1");
  });

  it("khách / account real / EA tắt: chỉ xem nhưng mọi đường lệnh vẫn bấm để chọn được, không đường nào kéo được", () => {
    useMt5Store.setState({ accounts: [{ ...account, ea_trading: false }], loaded: true });
    expect(targets().map((t) => t.id).sort()).toEqual(["o:2", "osl:2", "otp:2", "p:1", "psl:1", "ptp:1"]);
    expect(targets().every((t) => t.fixed === true)).toBe(true);
  });

  it("vừa bấm một đường chỉ-bấm thì cú click chart theo sau không bỏ chọn; click nền lần khác thì bỏ", () => {
    useTradeFocus.setState({ owner: "position:1" });
    h.tapped = true;
    clickHandler!();
    expect(useTradeFocus.getState().owner).toBe("position:1");
    h.tapped = false;
    clickHandler!();
    expect(useTradeFocus.getState().owner).toBeNull();
  });
});

describe("Replay: chart chỉ kéo lệnh của account cùng phía", () => {
  const targets = () => (h.host!.getTargets as () => { id: string; price: number }[])().map((t) => t.id);
  const simAccount = { ...account, id: SIM_ACCOUNT_ID, mode: "replay" } as Mt5Account;
  const simData = () => ({ account: simAccount, positions: [{ ...position, ticket: 1001 }], orders: [], deals: [], updated_at: 0 });

  it("chart đang Replay mà giao diện còn ở account MT5 (chưa chuyển): không kéo gì", () => {
    replayOn = true;
    expect(targets()).toEqual([]);
  });

  it("account giả lập: kéo được SL / TP như lệnh thật, kể cả khách và dữ liệu 'cũ' (sổ giả lập luôn mới)", () => {
    replayOn = true;
    useAuthStore.setState({ status: "guest" });
    useTradeStore.setState({ sim: true, data: simData() });
    expect(targets()).toEqual(["p:1001", "psl:1001", "ptp:1001"]);
    drop("psl:1001", 4100);
    expect(last()).toEqual([expect.objectContaining({ key: "psl:1001", price: 4100, pending: true })]);
  });

  it("chart thường khi đang có Replay ở chart khác: không kéo lệnh giả lập", () => {
    useTradeStore.setState({ sim: true, data: simData() });
    expect(targets()).toEqual([]);
  });
});
