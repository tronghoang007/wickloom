import { beforeEach, describe, expect, it } from "vitest";
import { chartGlobal } from "@/store/chart";
import type { PnlSpec } from "./pnl";
import { checkStop, emptySim, flatten, ingest, openPnl, placeOrder, seed, setStop, useReplaySim, type SimState } from "./replaySim";

const spec: PnlSpec = { tickSize: 0.01, tickValue: 1, tickValueLoss: 1 }; // 1 USD mỗi tick 0.01 cho 1 lot → 100 USD / 1.00 giá / lot
const at = (price: number, t = 1000, s: SimState = emptySim("XAUUSDm")): SimState => ({ ...s, price, time: t });
const bar = (t: number, o: { h?: number; l?: number; c: number }) => ({ t, h: o.h ?? o.c, l: o.l ?? o.c, c: o.c });

describe("placeOrder (netting)", () => {
  it("lệnh đầu mở vị thế ở giá nến hiện tại, chưa có SL / TP", () => {
    const s = placeOrder(at(4000), "buy", 0.1, spec);
    expect(s.position).toEqual({ side: "buy", lot: 0.1, entry: 4000, time: 1000, sl: 0, tp: 0 });
    expect(s.realized).toBe(0);
  });

  it("chưa có giá replay hoặc lot không hợp lệ → không làm gì", () => {
    expect(placeOrder(emptySim(), "buy", 0.1, spec).position).toBeNull();
    expect(placeOrder(at(4000), "buy", 0, spec).position).toBeNull();
  });

  it("cùng hướng: cộng lot, giá vào trung bình theo lot, giữ giờ mở và SL / TP đã đặt", () => {
    const a = setStop(placeOrder(at(4000), "buy", 0.1, spec), "sl", 3990);
    const b = placeOrder(at(4010, 2000, a), "buy", 0.3, spec);
    expect(b.position?.lot).toBeCloseTo(0.4);
    expect(b.position?.entry).toBeCloseTo((4000 * 0.1 + 4010 * 0.3) / 0.4);
    expect(b.position?.time).toBe(1000);
    expect(b.position?.sl).toBe(3990);
  });

  it("ngược hướng nhỏ hơn: chốt một phần, giữ giá vào cũ và SL / TP", () => {
    const a = setStop(placeOrder(at(4000), "buy", 1, spec), "sl", 3990);
    const b = placeOrder(at(4005, 2000, a), "sell", 0.4, spec);
    expect(b.position).toMatchObject({ side: "buy", lot: 0.6, entry: 4000, sl: 3990 });
    expect(b.realized).toBeCloseTo(0.4 * 500);
    expect(b.trades).toBe(1);
  });

  it("ngược hướng bằng lot: đóng hết; lớn hơn: đóng rồi đảo chiều phần dư ở giá hiện tại, SL / TP cũ không mang sang", () => {
    const a = setStop(placeOrder(at(4000), "sell", 0.5, spec), "tp", 3950);
    const closed = placeOrder(at(3990, 2000, a), "buy", 0.5, spec);
    expect(closed.position).toBeNull();
    expect(closed.realized).toBeCloseTo(0.5 * 1000);
    const flipped = placeOrder(at(3990, 2000, a), "buy", 0.8, spec);
    expect(flipped.position).toMatchObject({ side: "buy", entry: 3990, sl: 0, tp: 0 });
    expect(flipped.position?.lot).toBeCloseTo(0.3);
    expect(flipped.realized).toBeCloseTo(500);
  });
});

describe("openPnl / flatten", () => {
  it("lãi/lỗi đang mở theo giá hiện tại; không biết tick value → null; không vị thế → 0", () => {
    const a = placeOrder(at(4000), "buy", 0.1, spec);
    expect(openPnl(at(4002, 2000, a), spec)).toBeCloseTo(0.1 * 200);
    expect(openPnl(at(3998, 2000, a), spec)).toBeCloseTo(-0.1 * 200);
    expect(openPnl(a, null)).toBeNull();
    expect(openPnl(emptySim(), spec)).toBe(0);
  });

  it("Flatten chốt toàn bộ ở giá hiện tại và cộng vào lãi đã chốt", () => {
    const a = placeOrder(at(4000), "buy", 0.2, spec);
    const f = flatten(at(4001, 2000, a), spec);
    expect(f.position).toBeNull();
    expect(f.realized).toBeCloseTo(0.2 * 100);
    expect(flatten(f, spec)).toBe(f);
  });
});

describe("SL / TP giả lập", () => {
  const buy = () => placeOrder(at(4000), "buy", 0.1, spec);
  const sell = () => placeOrder(at(4000), "sell", 0.1, spec);

  it("checkStop: đúng phía của giá hiện tại; 0 = bỏ; không vị thế = chưa đặt được", () => {
    expect(checkStop(buy(), "sl", 3990)).toBeNull();
    expect(checkStop(buy(), "tp", 4010)).toBeNull();
    expect(checkStop(buy(), "sl", 4005)).toMatch(/SL.*Buy.*thấp hơn/);
    expect(checkStop(buy(), "tp", 3995)).toMatch(/TP.*Buy.*cao hơn/);
    expect(checkStop(sell(), "sl", 4010)).toBeNull();
    expect(checkStop(sell(), "tp", 4010)).toMatch(/TP.*Sell.*thấp hơn/);
    expect(checkStop(buy(), "sl", 0)).toBeNull();
    expect(checkStop(emptySim(), "sl", 1)).toBe("Chưa có vị thế");
  });

  it("setStop đặt / sửa / bỏ; mức sai phía thì giữ nguyên", () => {
    const a = setStop(buy(), "sl", 3990);
    expect(a.position?.sl).toBe(3990);
    expect(setStop(a, "sl", 4005)).toBe(a);
    expect(setStop(a, "sl", 0).position?.sl).toBe(0);
  });

  it("nến chạm SL: chốt ở ĐÚNG mức SL (không trượt), lỗ đúng, vị thế hết, có sự kiện", () => {
    const a = setStop(buy(), "sl", 3990);
    const s = ingest({ ...a, bar: { t: 1000, h: 4000, l: 4000 } }, bar(1060, { c: 3995, l: 3988 }), spec);
    expect(s.position).toBeNull();
    expect(s.realized).toBeCloseTo(0.1 * -1000); // 3990 − 4000 = −10.00 giá = −1000 tick × 1 USD × 0.1 lot
    expect(s.event).toMatchObject({ reason: "sl", price: 3990 });
    expect(s.event?.pnl).toBeCloseTo(-100);
    expect(s.price).toBe(3995);
  });

  it("nến chạm TP của lệnh Sell (giá chạm mức thấp)", () => {
    const a = setStop(sell(), "tp", 3990);
    const s = ingest(a, bar(1060, { c: 3995, l: 3985, h: 4001 }), spec);
    expect(s.position).toBeNull();
    expect(s.event).toMatchObject({ reason: "tp", price: 3990 });
    expect(s.realized).toBeCloseTo(100);
  });

  it("chạm cả SL lẫn TP trong một bước: tính SL trước", () => {
    const a = setStop(setStop(buy(), "sl", 3990), "tp", 4010);
    const s = ingest(a, bar(1060, { c: 4000, h: 4015, l: 3985 }), spec);
    expect(s.event?.reason).toBe("sl");
  });

  it("không chạm thì vị thế còn nguyên, chỉ cập nhật giá", () => {
    const a = setStop(setStop(buy(), "sl", 3990), "tp", 4010);
    const s = ingest(a, bar(1060, { c: 4004, h: 4006, l: 3995 }), spec);
    expect(s.position).toMatchObject({ sl: 3990, tp: 4010 });
    expect(s.event).toBeNull();
  });

  it("cùng nến đang gom dở: chỉ phần cao / thấp MỚI mở rộng mới tính (đỉnh cũ trước khi vào lệnh không kích TP)", () => {
    // nến 1000 đã có đỉnh 4012 trước khi ta vào lệnh Buy ở 4000 với TP 4010
    const open = { ...at(4000, 1000), bar: { t: 1000, h: 4012, l: 3999 } };
    const a = setStop(placeOrder(open, "buy", 0.1, spec), "tp", 4010);
    const same = ingest(a, bar(1000, { c: 4003, h: 4012, l: 3999 }), spec); // cùng nến, không mở rộng thêm
    expect(same.position).not.toBeNull();
    const higher = ingest(a, bar(1000, { c: 4003, h: 4013, l: 3999 }), spec); // đỉnh mới 4013 ≥ TP
    expect(higher.event).toMatchObject({ reason: "tp", price: 4010 });
  });

  it("đổi timeframe (seed): nến TF mới có đáy cũ dưới SL nhưng không chốt; bước sau chỉ tính phần mở rộng mới", () => {
    // 1h -> 4h giữa Replay: nến 4h đã có đáy 3985 từ trước lúc vào lệnh Buy, SL 3990
    const a = setStop(buy(), "sl", 3990);
    const s = seed(a, bar(900, { c: 4000, h: 4008, l: 3985 }));
    expect(s.position).not.toBeNull();
    expect(s.event).toBeNull();
    expect(ingest(s, bar(900, { c: 4001, h: 4008, l: 3985 }), spec).position).not.toBeNull();
    expect(ingest(s, bar(900, { c: 3995, h: 4008, l: 3984 }), spec).event).toMatchObject({ reason: "sl", price: 3990 });
  });

  it("nến mới: tính cả khoảng nhảy từ giá trước (gap) tới nến mới", () => {
    const a = setStop(buy(), "sl", 3990);
    const s = ingest(a, bar(2000, { c: 3980, h: 3985, l: 3978 }), spec);
    expect(s.event).toMatchObject({ reason: "sl", price: 3990 });
  });

  it("không biết tick value (spec null): không tự chốt", () => {
    const a = setStop(buy(), "sl", 3990);
    expect(ingest(a, bar(1060, { c: 3980, l: 3970 }), null).position).not.toBeNull();
  });

  it("sự kiện mới tăng id", () => {
    const a = setStop(buy(), "sl", 3990);
    const s1 = ingest(a, bar(1060, { c: 3980, l: 3970 }), spec);
    const b = setStop(placeOrder(at(3980, 2000, s1), "buy", 0.1, spec), "sl", 3970);
    const s2 = ingest(b, bar(2060, { c: 3960, l: 3955 }), spec);
    expect(s1.event?.id).toBe(1);
    expect(s2.event?.id).toBe(2);
  });
});

describe("kho theo pane", () => {
  beforeEach(() => {
    useReplaySim.setState({ byPane: {} });
    chartGlobal.setState({ symbols: [{ name: "XAUUSDm", digits: 2, tick_size: 0.01, tick_value: 1, type: "forex" } as never] });
  });

  it("mỗi pane có vị thế riêng; ingest → order → flatten", () => {
    const st = useReplaySim.getState();
    st.ingest("p1", "XAUUSDm", bar(1000, { c: 4000 }));
    st.order("p1", "buy", 0.1, spec);
    st.ingest("p2", "XAUUSDm", bar(1000, { c: 4000 }));
    expect(useReplaySim.getState().byPane.p1.position?.lot).toBe(0.1);
    expect(useReplaySim.getState().byPane.p2.position).toBeNull();
    useReplaySim.getState().ingest("p1", "XAUUSDm", bar(1060, { c: 4003 }));
    useReplaySim.getState().flatten("p1", spec);
    expect(useReplaySim.getState().byPane.p1.realized).toBeCloseTo(30);
  });

  it("setStop qua kho: sai phía trả false và không đổi; đúng phía trả true; ingest tự chốt khi chạm", () => {
    const st = useReplaySim.getState();
    st.ingest("p1", "XAUUSDm", bar(1000, { c: 4000 }));
    st.order("p1", "buy", 0.1, spec);
    expect(useReplaySim.getState().setStop("p1", "sl", 4010)).toBe(false);
    expect(useReplaySim.getState().byPane.p1.position?.sl).toBe(0);
    expect(useReplaySim.getState().setStop("p1", "sl", 3990)).toBe(true);
    useReplaySim.getState().ingest("p1", "XAUUSDm", bar(1060, { c: 3995, l: 3985 }));
    const s = useReplaySim.getState().byPane.p1;
    expect(s.position).toBeNull();
    expect(s.event?.reason).toBe("sl");
    expect(s.realized).toBeCloseTo(-100);
  });

  it("đổi symbol thì bắt đầu lại sạch nhưng giữ ô lot", () => {
    const st = useReplaySim.getState();
    st.ingest("p1", "XAUUSDm", bar(1000, { c: 4000 }));
    st.setLot("p1", "0.5");
    st.order("p1", "sell", 0.5, spec);
    useReplaySim.getState().ingest("p1", "EURUSDm", bar(1000, { c: 1.1 }));
    const s = useReplaySim.getState().byPane.p1;
    expect(s.position).toBeNull();
    expect(s.realized).toBe(0);
    expect(s.lot).toBe("0.5");
    expect(s.symbol).toBe("EURUSDm");
  });

  it("reset xoá pane", () => {
    useReplaySim.getState().ingest("p1", "X", bar(1, { c: 1 }));
    useReplaySim.getState().reset("p1");
    expect(useReplaySim.getState().byPane.p1).toBeUndefined();
    useReplaySim.getState().reset("nope");
  });
});
