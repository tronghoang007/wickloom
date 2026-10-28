import { describe, expect, it } from "vitest";
import { finishProfile, profileLayout } from "./compute";

describe("finishProfile", () => {
  const lay = (N: number) => ({ lo: 0, hi: N, size: 1, N });

  it("Value Area 100%: phủ mọi row dù volume lẻ (sai số làm tròn không làm hụt row ở mép)", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 3.7;
    for (let k = 0; k < 300; k++) {
      const N = 5 + (k % 40);
      const up = Array.from({ length: N }, rnd);
      const dn = Array.from({ length: N }, rnd);
      const p = finishProfile(lay(N), up, dn, 100)!;
      expect([p.vl, p.vh]).toEqual([0, N - 1]);
    }
  });

  it("Value Area 70%: dừng trước khi vượt mục tiêu", () => {
    const p = finishProfile(lay(5), [1, 2, 10, 2, 1], [0, 0, 0, 0, 0], 70)!; // tổng 16, mục tiêu 11.2
    expect([p.poc, p.vl, p.vh]).toEqual([2, 2, 2]); // 10 + 2 = 12 > 11.2
  });

  it("rất nhiều row (footprint 1 tick / row) không ném lỗi", () => {
    const N = 200_000;
    const up = new Array<number>(N).fill(0);
    up[123_456] = 5;
    expect(finishProfile(lay(N), up, new Array<number>(N).fill(0), 70)?.poc).toBe(123_456);
  });

  it("giá đứng yên một mức: một row cao 1 tick (không cao 0)", () => {
    const flat = [{ t: 0, o: 100, h: 100, l: 100, c: 100, v: 5 }];
    expect(profileLayout(flat, 0.5, 24)).toEqual({ lo: 100, hi: 100.5, size: 0.5, N: 1 });
  });

  it("Number of rows: Row Size 1 là một row, tới 1000 row (như ô nhập)", () => {
    const bars = [{ t: 0, o: 0, h: 5000, l: 0, c: 5000, v: 1 }];
    expect(profileLayout(bars, 1, 1)?.N).toBe(1);
    expect(profileLayout(bars, 1, 1000)?.N).toBe(1000);
  });
});
