import { describe, expect, it } from "vitest";
import type { PnlSpec } from "./pnl";
import * as sim from "./sim";
import { SIM_ACCOUNT_ID } from "./simId";

// Vàng: tick 0.001, mỗi tick 1 lot = 0.1 USD (100 oz); spread 0.2
const GOLD: PnlSpec = { tickSize: 0.001, tickValue: 0.1, tickValueLoss: 0.1 };
const env: sim.SimEnv = () => ({ spec: GOLD, digits: 3, stopsLevel: 0 });
const S = "XAUUSDm";
const INFO: sim.SimAccountInfo = { currency: "USD", leverage: 100, hedging: true, name: "Replay", server: "Replay", broker: "" };

const start = (hedging = true, bid = 4000, balance = 10_000) => sim.seed(sim.newBook({ ...INFO, hedging }, balance), S, bid, 1000, 0.2, env);
const bar = (t: number, o: number, h: number, l: number, c: number): sim.SimBar => ({ t, o, h, l, c });
const ok = (out: sim.SimOut) => {
  expect(out.result.message).toBe("");
  expect(out.result.ok).toBe(true);
  return out.book;
};

describe("market", () => {
  it("Buy vào ở Ask, Sell ở Bid; lãi/lỗi tính theo giá đóng (Buy ở Bid)", () => {
    let b = ok(sim.marketOrder(start(), { symbol: S, side: "buy", volume: 1 }, env));
    expect(b.positions[0]).toMatchObject({ type: "buy", price_open: 4000.2, price_current: 4000, profit: -20 });
    b = ok(sim.marketOrder(b, { symbol: S, side: "sell", volume: 0.5 }, env));
    expect(b.positions).toHaveLength(2); // hedging: hai vị thế
    expect(b.positions[1]).toMatchObject({ type: "sell", price_open: 4000 });
  });

  it("chưa có giá / chưa biết tick value / SL sai phía / không đủ tiền: sàn từ chối, sổ không đổi", () => {
    const empty = sim.newBook(INFO, 1000);
    expect(sim.marketOrder(empty, { symbol: S, side: "buy", volume: 1 }, env).result).toMatchObject({ ok: false, retcode: 10021 });
    const noSpec: sim.SimEnv = () => ({ spec: null, digits: 3, stopsLevel: 0 });
    expect(sim.marketOrder(start(), { symbol: S, side: "buy", volume: 1 }, noSpec).result.ok).toBe(false);
    expect(sim.marketOrder(start(), { symbol: S, side: "buy", volume: 1, sl: 4001 }, env).result).toMatchObject({ ok: false, retcode: 10016 });
    // 1 lot vàng ở 4000, đòn bẩy 100: margin 4000 USD
    const poor = start(true, 4000, 3000);
    const r = sim.marketOrder(poor, { symbol: S, side: "buy", volume: 1 }, env);
    expect(r.result).toMatchObject({ ok: false, retcode: 10019 });
    expect(r.book).toBe(poor);
  });

  it("netting: cùng hướng cộng dồn giá trung bình, ngược hướng đóng bớt rồi đảo chiều phần dư", () => {
    let b = ok(sim.marketOrder(start(false), { symbol: S, side: "buy", volume: 1 }, env));
    b = sim.seed(b, S, 4010, 1060, 0, env);
    b = ok(sim.marketOrder(b, { symbol: S, side: "buy", volume: 1 }, env));
    expect(b.positions).toHaveLength(1);
    expect(b.positions[0].volume).toBe(2);
    expect(b.positions[0].price_open).toBeCloseTo(4005.2, 6);
    b = ok(sim.marketOrder(b, { symbol: S, side: "sell", volume: 3 }, env));
    expect(b.positions).toHaveLength(1);
    expect(b.positions[0]).toMatchObject({ type: "sell", volume: 1, price_open: 4010 });
    expect(b.balance).toBeCloseTo(10_000 + (4010 - 4005.2) * 2 * 100, 4);
  });
});

describe("đóng / sửa", () => {
  it("đóng một phần: deal out có lãi vào balance, vị thế còn phần dư; lịch sử có mã vị thế và lý do", () => {
    let b = ok(sim.marketOrder(start(), { symbol: S, side: "buy", volume: 1 }, env));
    const t = b.positions[0].ticket;
    b = sim.seed(b, S, 4010.2, 1060, 0, env);
    b = ok(sim.closePosition(b, t, 0.4, env));
    expect(b.positions[0].volume).toBe(0.6);
    expect(b.balance).toBeCloseTo(10_000 + 10 * 0.4 * 100, 6);
    const out = b.deals[b.deals.length - 1];
    expect(out).toMatchObject({ entry: "out", type: "sell", volume: 0.4, price: 4010.2, position: t, reason: "web" });
  });

  it("sửa SL / TP vị thế: kiểm phía so với giá đóng; lệnh chờ đổi giá nhưng không được đổi loại", () => {
    let b = ok(sim.marketOrder(start(), { symbol: S, side: "buy", volume: 1 }, env));
    const t = b.positions[0].ticket;
    expect(sim.modifyPosition(b, t, { sl: 4000.1 }, env).result.ok).toBe(false); // trên Bid
    b = ok(sim.modifyPosition(b, t, { sl: 3990, tp: 4020 }, env));
    expect(b.positions[0]).toMatchObject({ sl: 3990, tp: 4020 });
    b = ok(sim.pendingOrder(b, { symbol: S, side: "buy", volume: 1, price: 3980 }, env));
    const o = b.orders[0].ticket;
    expect(b.orders[0].type).toBe("buy_limit");
    expect(sim.modifyOrder(b, o, { price: 4010 }, env).result.ok).toBe(false); // sẽ thành Buy stop
    b = ok(sim.modifyOrder(b, o, { price: 3970, sl: 3960 }, env));
    expect(b.orders[0]).toMatchObject({ price_open: 3970, sl: 3960 });
  });
});

describe("feed: giá replay chạy", () => {
  it("Buy limit khớp khi Ask chạm (Bid = mức - spread), đúng mức; SL của nó chạm sau đó trong cùng nến", () => {
    let b = ok(sim.pendingOrder(start(), { symbol: S, side: "buy", volume: 1, price: 3990, sl: 3985 }, env));
    // nến giảm: mở 4000 → cao 4001 → thấp 3980 → đóng 3995: Ask chạm 3990 khi Bid xuống 3989.8, rồi Bid xuống 3985 chạm SL
    b = sim.feed(b, S, [bar(1060, 4000, 4001, 3980, 3995)], 1120, env);
    expect(b.orders).toHaveLength(0);
    expect(b.positions).toHaveLength(0);
    const kinds = b.events.map((e) => e.kind);
    expect(kinds).toEqual(["fill", "sl"]);
    const [inDeal, outDeal] = b.deals.slice(-2);
    expect(inDeal).toMatchObject({ entry: "in", price: 3990 });
    expect(outDeal).toMatchObject({ entry: "out", price: 3985, reason: "sl" });
    expect(b.balance).toBeCloseTo(10_000 - 5 * 100, 6);
  });

  it("thứ tự OHLC: nến tăng đi thấp trước rồi cao (SL chạm trước TP), nến giảm ngược lại", () => {
    const withStops = () => ok(sim.marketOrder(start(), { symbol: S, side: "buy", volume: 1, sl: 3990, tp: 4010 }, env));
    expect(sim.feed(withStops(), S, [bar(1060, 4000, 4015, 3985, 4005)], 1120, env).events[0].kind).toBe("sl");
    expect(sim.feed(withStops(), S, [bar(1060, 4000, 4015, 3985, 3995)], 1120, env).events[0].kind).toBe("tp");
  });

  it("SL / TP của Sell xét theo Ask", () => {
    let b = ok(sim.marketOrder(start(), { symbol: S, side: "sell", volume: 1, sl: 4005 }, env));
    b = sim.feed(b, S, [bar(1060, 4000, 4004.9, 3999, 4004.9)], 1120, env); // Ask lên 4005.1 > SL
    expect(b.events.map((e) => e.kind)).toEqual(["sl"]);
    expect(b.deals[b.deals.length - 1].price).toBe(4005);
  });

  it("nhảy giá qua mức (giá mở nến mới bên kia mức): khớp ở giá mở, Stop bị trượt", () => {
    let b = ok(sim.marketOrder(start(), { symbol: S, side: "buy", volume: 1, sl: 3990 }, env));
    b = sim.feed(b, S, [bar(1060, 3980, 3985, 3975, 3982)], 1120, env);
    expect(b.deals[b.deals.length - 1]).toMatchObject({ reason: "sl", price: 3980 });
  });

  it("lệnh chờ hết hạn theo giờ replay thì bị huỷ, không khớp", () => {
    let b = ok(sim.pendingOrder(start(), { symbol: S, side: "buy", volume: 1, price: 3990, expiration: 1100 }, env));
    b = sim.feed(b, S, [bar(1060, 4000, 4001, 3999, 4000), bar(1120, 4000, 4000, 3980, 3985)], 1180, env);
    expect(b.orders).toHaveLength(0);
    expect(b.positions).toHaveLength(0);
    expect(b.events.map((e) => e.kind)).toEqual(["expire"]);
  });

  it("stop out: equity về 0 thì đóng mọi vị thế", () => {
    let b = ok(sim.marketOrder(start(true, 4000, 5000), { symbol: S, side: "buy", volume: 1 }, env));
    b = sim.feed(b, S, [bar(1060, 4000, 4000, 3940, 3945)], 1120, env);
    expect(b.positions).toHaveLength(0);
    expect(b.events.some((e) => e.kind === "so")).toBe(true);
    expect(b.balance).toBeLessThanOrEqual(0.01);
  });
});

describe("snapshot / closeAll", () => {
  it("khuôn TradeData của MT5: account REPLAY với equity / margin / free margin", () => {
    const b = ok(sim.marketOrder(start(), { symbol: S, side: "buy", volume: 1 }, env));
    const d = sim.snapshot(b, env, 5);
    expect(d.account).toMatchObject({ id: SIM_ACCOUNT_ID, mode: "replay", balance: 10_000, equity: 9980, margin: 4000.2, margin_free: 5979.8, profit: -20, online: true });
    expect(d.updated_at).toBe(5);
    expect(d.deals[0]).toMatchObject({ type: "balance", profit: 10_000, time: 1000 });
  });

  it("closeAll: đóng vị thế ở giá hiện tại + huỷ lệnh chờ (hết phiên Replay), giữ lịch sử", () => {
    let b = ok(sim.marketOrder(start(), { symbol: S, side: "buy", volume: 1 }, env));
    b = ok(sim.pendingOrder(b, { symbol: S, side: "sell", volume: 1, price: 4050 }, env));
    b = sim.closeAll(b, env);
    expect(b.positions).toHaveLength(0);
    expect(b.orders).toHaveLength(0);
    expect(b.balance).toBeCloseTo(9980, 6);
    expect(b.deals.filter((d) => d.entry === "out")).toHaveLength(1);
  });
});
