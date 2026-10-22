import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mt5Account } from "@/lib/mt5Api";

const h = vi.hoisted(() => ({ placeMarket: vi.fn(), placePending: vi.fn() }));
vi.mock("./actions", () => ({ placeMarket: h.placeMarket, placePending: h.placePending, useOrderState: { getState: () => ({ busy: false }) } }));
vi.mock("@/store/toast", () => ({ toast: vi.fn() }));

import { useAuthStore } from "@/store/auth";
import { chartGlobal } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { useRailStore } from "@/store/rail";
import { useQuoteStore } from "./quote";
import { submitDraft } from "./submit";
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
