import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mt5Account } from "@/lib/mt5Api";

const h = vi.hoisted(() => ({ placeMarket: vi.fn(), placePending: vi.fn() }));
vi.mock("./actions", () => ({ placeMarket: h.placeMarket, placePending: h.placePending, useOrderState: { getState: () => ({ busy: false }) } }));
vi.mock("@/store/toast", () => ({ toast: vi.fn() }));

import { useAuthStore } from "@/store/auth";
import { chartGlobal } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { useRailStore } from "@/store/rail";
import { useTradeFocus } from "./focus";
import { useQuoteStore } from "./quote";
import { startDraft, submitDraft } from "./submit";
import { useTicketStore } from "./ticket";

const account = { id: "S:1", server: "S", broker: "B", login: 1, name: "n", mode: "demo", currency: "USD", leverage: 500, online: true, active: true, seen: 1, ea_trading: true } as Mt5Account;

beforeEach(() => {
  h.placeMarket.mockReset().mockResolvedValue(true);
  h.placePending.mockReset().mockResolvedValue(true);
  useAuthStore.setState({ status: "user" });
  useMt5Store.setState({ accounts: [account], loaded: true });
  useQuoteStore.setState({ quotes: { XAUUSDm: { bid: 4130, ask: 4130.2 } } });
  chartGlobal.setState({ symbols: [{ name: "XAUUSDm", digits: 3, tick_size: 0.001, volume_min: 0.01, volume_max: 100, volume_step: 0.01, stops_level: 0 } as never] });
  useRailStore.setState({ open: null, before: null });
  useTicketStore.setState({ draft: null, rest: null });
});

describe("đặt lệnh xong: bảng đặt lệnh ở thanh bên phải KHÔNG đóng, về trạng thái chờ như TradingView", () => {
  it("market: bản nháp bỏ đi (chart hết đường entry/SL/TP), bảng ở lại chờ với hướng / loại lệnh đã dùng; thanh vẫn ở bảng Order", async () => {
    useTicketStore.getState().open({ symbol: "XAUUSDm", side: "sell", mode: "market" });
    useTicketStore.getState().patch({ lot: "0.05", sl: "4150.000", tp: "4100.000" });
    expect(await submitDraft()).toBe(true);
    expect(h.placeMarket).toHaveBeenCalledWith("sell", "XAUUSDm", 0.05, 3, { sl: 4150, tp: 4100 });
    const t = useTicketStore.getState();
    expect(t.draft).toBeNull();
    expect(t.rest).toEqual({ side: "sell", mode: "market" });
    expect(useRailStore.getState().open).toBe("order");
  });

  it("lệnh chờ: nhớ loại lệnh chờ", async () => {
    useTicketStore.getState().open({ symbol: "XAUUSDm", side: "buy", mode: "pending", price: 4100 });
    useTicketStore.getState().patch({ price: "4100.000", tp: "4150.000" });
    expect(await submitDraft()).toBe(true);
    expect(h.placePending).toHaveBeenCalledOnce();
    expect(useTicketStore.getState().draft).toBeNull();
    expect(useTicketStore.getState().rest).toEqual({ side: "buy", mode: "pending" });
  });

  it("bấm Sell / Buy (open) khi đang chờ: bắt đầu bản nháp mới, hết trạng thái chờ, id đổi để form dựng lại", async () => {
    useTicketStore.getState().open({ symbol: "XAUUSDm", side: "buy", mode: "market" });
    await submitDraft();
    const idBefore = useTicketStore.getState().id;
    useTicketStore.getState().open({ symbol: "XAUUSDm", side: "sell", mode: "market" });
    const t = useTicketStore.getState();
    expect(t.draft).toMatchObject({ symbol: "XAUUSDm", side: "sell", sl: "", tp: "" });
    expect(t.rest).toBeNull();
    expect(t.id).toBeGreaterThan(idBefore);
    expect(useRailStore.getState().open).toBe("order");
  });

  it("× / Esc khi đang chờ: bảng đóng hẳn và thanh trả về panel trước đó", async () => {
    useRailStore.setState({ open: "watchlist", before: null });
    useTicketStore.getState().open({ symbol: "XAUUSDm", side: "buy", mode: "market" });
    await submitDraft();
    useTicketStore.getState().close();
    expect(useTicketStore.getState().rest).toBeNull();
    expect(useRailStore.getState().open).toBe("watchlist");
  });

  it("sàn từ chối: bản nháp giữ nguyên để sửa rồi gửi lại, không vào trạng thái chờ", async () => {
    h.placeMarket.mockResolvedValue(false);
    useTicketStore.getState().open({ symbol: "XAUUSDm", side: "buy", mode: "market" });
    useTicketStore.getState().patch({ sl: "4100.000" });
    const idBefore = useTicketStore.getState().id;
    expect(await submitDraft()).toBe(false);
    expect(useTicketStore.getState().draft?.sl).toBe("4100.000");
    expect(useTicketStore.getState().rest).toBeNull();
    expect(useTicketStore.getState().id).toBe(idBefore);
  });

  it("người dùng đóng bảng trong lúc lệnh đang bay: không tự mở lại", async () => {
    h.placeMarket.mockImplementation(async () => {
      useTicketStore.getState().close();
      return true;
    });
    useTicketStore.getState().open({ symbol: "XAUUSDm", side: "buy", mode: "market" });
    expect(await submitDraft()).toBe(true);
    expect(useTicketStore.getState().draft).toBeNull();
    expect(useTicketStore.getState().rest).toBeNull();
    expect(useRailStore.getState().open).toBeNull();
  });
});

describe("bản nháp mới sau khi chọn một lệnh đã đặt", () => {
  it("mở bản nháp mới thì bỏ focus của lệnh cũ (nếu không bản nháp bị mờ như lệnh khác)", () => {
    useTradeFocus.getState().set("order:123");
    useTicketStore.getState().open({ symbol: "XAUUSDm", side: "buy", mode: "market" });
    expect(useTradeFocus.getState().owner).toBeNull();
  });
});

describe("bắt đầu bản nháp từ bảng đang chờ", () => {
  it("lệnh chờ: có sẵn giá vào gợi ý (Buy dưới thị trường) để chart có đường kéo được", () => {
    startDraft("XAUUSDm", "buy", "pending");
    const d = useTicketStore.getState().draft!;
    expect(d.mode).toBe("pending");
    expect(parseFloat(d.price)).toBeGreaterThan(0);
    expect(parseFloat(d.price)).toBeLessThan(4130);
  });
  it("market: không cần giá vào", () => {
    startDraft("XAUUSDm", "sell", "market");
    expect(useTicketStore.getState().draft!.price).toBe("");
  });
});

describe("kéo một lệnh đã đặt", () => {
  it("thanh bên phải đang ở bảng đặt lệnh thì đổi sang lệnh đang kéo (không dựng lại khi kéo tiếp)", () => {
    useRailStore.setState({ open: "order", before: null });
    useTicketStore.getState().follow("order:7");
    const id = useTicketStore.getState().id;
    expect(useTicketStore.getState().modifyOwner).toBe("order:7");
    useTicketStore.getState().follow("order:7");
    expect(useTicketStore.getState().id).toBe(id);
    useTicketStore.getState().follow("position:9");
    expect(useTicketStore.getState().modifyOwner).toBe("position:9");
  });
  it("thanh đang đóng hoặc ở panel khác thì kéo không mở nó ra", () => {
    useRailStore.setState({ open: null, before: null });
    useTicketStore.setState({ modifyOwner: null });
    useTicketStore.getState().follow("order:7");
    expect(useTicketStore.getState().modifyOwner).toBeNull();
    expect(useRailStore.getState().open).toBeNull();
    useRailStore.setState({ open: "watchlist" });
    useTicketStore.getState().follow("order:7");
    expect(useTicketStore.getState().modifyOwner).toBeNull();
  });
});
