import type { Bar } from "@/lib/api";
import { describe, expect, it } from "vitest";
import { TickProfileFeed, coverSig, coversFrom, type TickHist } from "./tickProfile";

const td = (t: number, c = 1, v = 1): Bar => ({ t, o: 0, h: 0, l: 0, c, v });
const lay = { lo: 100, hi: 110, size: 5, N: 2 };

describe("coversFrom / coverSig", () => {
  const cover = [td(1000), td(1060), td(1120)];
  it("phủ tới đầu khi nến delta đầu tiên không muộn hơn 5 phút sau đầu profile", () => {
    expect(coversFrom(cover, 1000)).toBe(true);
    expect(coversFrom(cover, 800)).toBe(true); // 1000 <= 800 + 300
    expect(coversFrom(cover, 600)).toBe(false);
    expect(coversFrom([], 0)).toBe(false);
  });
  it("chữ ký đổi khi thêm phút hoặc phút cuối đổi giá trị, không đổi khi nến ngoài khoảng đổi", () => {
    const base = coverSig(cover, 1000, 1180);
    expect(coverSig([...cover, td(1180)], 1000, 1180)).toBe(base); // phút 1180 ngoài [1000, 1180)
    expect(coverSig([...cover.slice(0, 2), td(1120, 1, 5)], 1000, 1180)).not.toBe(base); // phút cuối được tính lại
    expect(coverSig([td(940), ...cover], 1000, 1180)).toBe(base); // phút trước khoảng
    expect(coverSig(cover, 1000, 1120)).not.toBe(base);
    expect(coverSig(cover, 5000, 6000)).toBe("0");
  });
});

describe("TickProfileFeed", () => {
  const mk = (opts: { fail?: boolean } = {}) => {
    const calls: [string, number, number][] = [];
    let release: (() => void)[] = [];
    let changed = 0;
    let clock = 0;
    const feed = new TickProfileFeed(
      (symbol, from, to) =>
        new Promise<TickHist | null>((res) => {
          calls.push([symbol, from, to]);
          release.push(() => res(opts.fail ? null : { up: [from, 0], dn: [0, to] }));
        }),
      () => changed++,
      () => clock,
    );
    return { feed, calls, flush: async () => { const r = release; release = []; r.forEach((f) => f()); await Promise.resolve(); await Promise.resolve(); }, changed: () => changed, tick: (ms: number) => (clock += ms) };
  };

  it("lần đầu null và nạp ngầm; xong thì trả dữ liệu và báo onChange; cùng chữ ký không nạp lại", async () => {
    const { feed, calls, flush, changed } = mk();
    expect(feed.get("S", 10, 20, lay, "a")).toBeNull();
    expect(calls).toEqual([["S", 10, 20]]);
    expect(feed.get("S", 10, 20, lay, "a")).toBeNull(); // đang nạp: không xin lần hai
    expect(calls).toHaveLength(1);
    await flush();
    expect(changed()).toBe(1);
    expect(feed.get("S", 10, 20, lay, "a")).toEqual({ up: [10, 0], dn: [0, 20] });
    expect(calls).toHaveLength(1);
  });

  it("chữ ký đổi: nạp lại nhưng vẫn trả bản cũ trong lúc chờ", async () => {
    const { feed, calls, flush } = mk();
    feed.get("S", 10, 20, lay, "a");
    await flush();
    expect(feed.get("S", 10, 20, lay, "b")).not.toBeNull();
    expect(calls).toHaveLength(2);
    await flush();
    expect(feed.get("S", 10, 20, lay, "b")).not.toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("row khác (đổi vùng giá hoặc số row) là profile khác", async () => {
    const { feed, calls } = mk();
    feed.get("S", 10, 20, lay, "a");
    feed.get("S", 10, 20, { ...lay, N: 3 }, "a");
    expect(calls).toHaveLength(2); // MAX_ACTIVE = 2
  });

  it("tối đa 2 yêu cầu cùng lúc; xong thì onChange để profile còn lại được xin", async () => {
    const { feed, calls, flush } = mk();
    for (let t = 0; t < 4; t++) feed.get("S", t, t + 1, lay, "a");
    expect(calls).toHaveLength(2);
    await flush();
    for (let t = 0; t < 4; t++) feed.get("S", t, t + 1, lay, "a");
    expect(calls).toHaveLength(4);
  });

  it("lỗi hoặc sai độ dài: không dùng, thử lại sau 10 giây", async () => {
    const { feed, calls, flush, tick } = mk({ fail: true });
    feed.get("S", 10, 20, lay, "a");
    await flush();
    expect(feed.get("S", 10, 20, lay, "a")).toBeNull();
    expect(calls).toHaveLength(1);
    tick(10_001);
    feed.get("S", 10, 20, lay, "a");
    expect(calls).toHaveLength(2);
  });
});
