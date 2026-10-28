import { beforeEach, describe, expect, it, vi } from "vitest";

const placePending = vi.fn();
vi.mock("@/trading/actions", () => ({ placePending: (...a: unknown[]) => placePending(...a) }));
vi.mock("../icons", () => ({ AddOrderI: () => null, BuyI: () => null, SellI: () => null }));

import { useAuthStore } from "@/store/auth";
import { chartGlobal } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import type { Mt5Account } from "@/lib/mt5Api";
import { useQuoteStore } from "@/trading/quote";
import { useTradeStore } from "@/trading/store";
import { tradeMenuItems } from "./tradeMenu";

const XAU = { name: "XAUUSDm", digits: 3, tick_size: 0.001, type: "metal", volume_min: 0.01, volume_max: 100, volume_step: 0.01 };
const acc = { id: "S:1", server: "S", mode: "demo", online: true, active: true, ea_trading: true } as Mt5Account;
const labels = (price: number, replay = false) => tradeMenuItems("XAUUSDm", price, 3, undefined, replay).slice(0, 2).map((m) => (m === "sep" ? "" : m.label));

beforeEach(() => {
  placePending.mockReset();
  chartGlobal.setState({ symbols: [XAU] } as never);
  useMt5Store.setState({ accounts: [acc], loaded: true });
  useAuthStore.setState({ status: "user" } as never);
  useTradeStore.setState({ sim: false, data: null, real: null });
  useQuoteStore.setState({ quotes: { XAUUSDm: { bid: 4100, ask: 4100.4 } }, real: { XAUUSDm: { bid: 4100, ask: 4100.4 } }, sim: false });
});

describe("tradeMenuItems: nhãn Limit / Stop theo loại EA sẽ đặt", () => {
  it("ngoài spread: trên thị trường Sell limit + Buy stop, dưới thị trường Buy limit + Sell stop", () => {
    expect(labels(4110)).toEqual(["Sell 0.01 XAUUSDm @ 4,110.000 limit", "Buy 0.01 XAUUSDm @ 4,110.000 stop"]);
    expect(labels(4090)).toEqual(["Buy 0.01 XAUUSDm @ 4,090.000 limit", "Sell 0.01 XAUUSDm @ 4,090.000 stop"]);
  });
  it("bấm trong spread: dòng 'stop' thật ra là Limit → nhãn nói Limit (trước đây ghi stop mà đặt limit)", () => {
    expect(labels(4100.3)).toEqual(["Sell 0.01 XAUUSDm @ 4,100.300 limit", "Buy 0.01 XAUUSDm @ 4,100.300 limit"]);
    expect(labels(4100.1)).toEqual(["Buy 0.01 XAUUSDm @ 4,100.100 limit", "Sell 0.01 XAUUSDm @ 4,100.100 limit"]);
  });
  it("đúng giá Ask: dòng Buy tắt (không đặt lệnh chờ được ở đó)", () => {
    const [, buy] = tradeMenuItems("XAUUSDm", 4100.4, 3, undefined, false);
    expect(buy !== "sep" && buy.disabled).toBe(true);
  });
  it("pane khác đang Replay: chart thường dùng giá thật, không dùng giá giả lập", () => {
    useQuoteStore.setState({ quotes: { XAUUSDm: { bid: 3000, ask: 3000.4 } }, sim: true });
    expect(labels(4050)[0]).toMatch(/^Buy .* limit$/); // giá thật 4100: 4050 dưới thị trường (theo giá giả lập 3000 sẽ thành Sell limit)
    expect(labels(4050, true)[0]).toMatch(/^Sell .* limit$/); // chính chart đang Replay thì dùng giá giả lập
  });
});
