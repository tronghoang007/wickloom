import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/api";
import { mergeBars, priceExtent, tickInBar } from "./transform";

const bar = (t: number, c: number, h = c, l = c): Bar => ({ t, o: c, h, l, c, v: 1 });

describe("mergeBars", () => {
  it("nến DB thay nến cũ cùng mốc trừ nến đang chạy liveT", () => {
    const cur = [bar(60, 1), bar(120, 2), bar(180, 3)];
    const out = mergeBars(cur, [bar(120, 20), bar(180, 30), bar(240, 40)], 180);
    expect(out.map((b) => [b.t, b.c])).toEqual([[60, 1], [120, 20], [180, 3], [240, 40]]);
  });

  it("liveT = Infinity: nến WS đẩy tới trong lúc tải đè nến DB cùng mốc, không trùng mốc, tăng dần", () => {
    const db = [bar(60, 1), bar(120, 2)];
    const live = [bar(120, 2.5), bar(180, 3)];
    const out = mergeBars(db, live, Infinity);
    expect(out.map((b) => [b.t, b.c])).toEqual([[60, 1], [120, 2.5], [180, 3]]);
  });
});

describe("priceExtent", () => {
  it("rỗng = null", () => expect(priceExtent([])).toBeNull());

  it("không vỡ với 200k nến (Math.min(...arr) ném RangeError từ ~125k)", () => {
    const bars = Array.from({ length: 200_000 }, (_, i) => bar(i * 60, 100, 100 + (i % 7), 100 - (i % 5)));
    expect(priceExtent(bars)).toEqual({ lo: 96, hi: 106 });
  });
});

describe("tickInBar", () => {
  const last = { t: 3600 };
  it("tick trong nến cuối thì áp", () => {
    expect(tickInBar(last, "H1", 3600)).toBe(true);
    expect(tickInBar(last, "H1", 7199.9)).toBe(true);
  });

  it("tick của nến sau (bar_update nến mới chưa tới) hoặc tick cũ: không áp vào nến đã đóng", () => {
    expect(tickInBar(last, "H1", 7200)).toBe(false);
    expect(tickInBar(last, "M1", 3660)).toBe(false);
    expect(tickInBar(last, "H1", 3599)).toBe(false);
  });

  it("MN1 dài 28-31 ngày: chỉ chặn tick cũ; thiếu giờ tick thì vẫn áp", () => {
    expect(tickInBar(last, "MN1", 3600 + 31 * 86400 - 1)).toBe(true);
    expect(tickInBar(last, "H1", undefined)).toBe(true);
  });
});
