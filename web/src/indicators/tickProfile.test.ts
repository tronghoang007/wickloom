import type { Bar, TickCell } from "@/lib/api";
import { describe, expect, it } from "vitest";
import { TickBigFeed, TickProfileFeed, addLiveHist, coverSig, coversFrom, liveCut, liveFrom, mergeLiveBig, type LiveMinute, type TickHist } from "./tickProfile";

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

describe("TickBigFeed", () => {
  const mk = () => {
    const calls: [string, number, number, number, number, number][] = [];
    let changed = 0;
    const feed = new TickBigFeed(async (symbol, from, to, min, limit, size) => (calls.push([symbol, from, to, min, limit, size]), [{ t: from, p: 1, up: min, dn: 0 } as TickCell]), () => changed++);
    return { feed, calls, changed: () => changed, settle: async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); } };
  };

  it("lần đầu null và nạp ngầm; xong thì trả các ô và báo onChange; cùng chữ ký không nạp lại", async () => {
    const { feed, calls, settle, changed } = mk();
    expect(feed.get("S", 10, 20, 3, 100, 0.5, "a")).toBeNull();
    await settle();
    expect(changed()).toBe(1);
    expect(feed.get("S", 10, 20, 3, 100, 0.5, "a")).toEqual([{ t: 10, p: 1, up: 3, dn: 0 }]);
    expect(calls).toEqual([["S", 10, 20, 3, 100, 0.5]]);
  });

  it("chữ ký đổi: nạp lại, vẫn trả bản cũ trong lúc chờ; đổi ngưỡng, số ô hoặc row giá là khoá khác", async () => {
    const { feed, calls, settle } = mk();
    feed.get("S", 10, 20, 3, 100, 0.5, "a");
    await settle();
    expect(feed.get("S", 10, 20, 3, 100, 0.5, "b")).not.toBeNull();
    await settle();
    expect(calls).toHaveLength(2);
    expect(feed.get("S", 10, 20, 4, 100, 0.5, "b")).toBeNull();
    expect(feed.get("S", 10, 20, 3, 50, 0.5, "b")).toBeNull();
    expect(feed.get("S", 10, 20, 3, 100, 1, "b")).toBeNull(); // row giá khác
    await settle();
    expect(calls.slice(2).map((c) => [c[3], c[4], c[5]])).toEqual([[4, 100, 0.5], [3, 50, 0.5]]); // tối đa 2 yêu cầu cùng lúc
    expect(calls).toHaveLength(4);
  });
});

describe("phút đang chạy (realtime)", () => {
  const live: LiveMinute = { t: 120, cells: [[100.2, 3, 0], [100.8, 1, 2], [101.5, 0, 4], [90, 5, 0], [200, 0, 1]] };
  const l3 = { lo: 100, hi: 103, size: 1, N: 3 };

  it("liveCut: DB chỉ đọc tới đầu phút đang chạy khi nó nằm trong khoảng", () => {
    expect(liveCut(live, 0, 600)).toBe(120);
    expect(liveCut(live, 0, 120)).toBe(120); // phút đang chạy bắt đầu đúng t1 = ngoài [t0, t1): đọc hết t1
    expect(liveCut(live, 0, 100)).toBe(100);
    expect(liveCut(live, 200, 600)).toBe(600);
    expect(liveCut(undefined, 0, 600)).toBe(600);
  });

  it("liveFrom: phút từ mốc DB đang giữ trở đi và nằm trong khoảng", () => {
    const a: LiveMinute = { t: 60, cells: [] };
    const b: LiveMinute = { t: 120, cells: [] };
    const c: LiveMinute = { t: 180, cells: [] };
    expect(liveFrom([a, b, c], 120, 0, 600)).toEqual([b, c]); // DB giữ tới 120: phút 60 đã có trong DB
    expect(liveFrom([a, b, c], 60, 0, 600)).toEqual([a, b, c]); // DB còn cũ (đang đọc lại): phút vừa đóng vẫn lấy từ bộ nhớ
    expect(liveFrom([a, b, c], 0, 100, 150)).toEqual([b]);
  });

  it("addLiveHist: tick vào đúng row như backend, giá ngoài khoảng dồn vào row đầu / cuối, không sửa bản gốc", () => {
    const h: TickHist = { up: [1, 0, 0], dn: [0, 0, 1] };
    const out = addLiveHist(h, l3, [live]);
    // row 0 = [100, 101): 100.2 (3 lên) + 100.8 (1 lên, 2 xuống) + 90 dồn vào đầu (5 lên); row 1 = [101, 102): 101.5 (4 xuống); 200 dồn vào row cuối (1 xuống)
    expect(out).toEqual({ up: [1 + 3 + 1 + 5, 0, 0], dn: [2, 4, 1 + 1] });
    expect(h).toEqual({ up: [1, 0, 0], dn: [0, 0, 1] });
    expect(addLiveHist(h, l3, [])).toBe(h);
    // nhiều phút cộng dồn
    expect(addLiveHist(h, l3, [live, { t: 180, cells: [[101.2, 2, 0]] }]).up).toEqual([10, 2, 0]);
  });

  it("mergeLiveBig: gom giá vào row (giá trung bình theo volume), bỏ ô nhỏ, giữ limit ô lớn nhất theo thời gian", () => {
    const base: TickCell[] = [{ t: 0, p: 100, up: 4, dn: 0 }, { t: 60, p: 101, up: 0, dn: 3 }];
    const cells: LiveMinute = { t: 120, cells: [[100.2, 3, 0], [100.8, 1, 2], [101.5, 0, 4]] };
    const out = mergeLiveBig(base, [cells], 4, 10, 1);
    // row [100, 101) = 100.2 (3) + 100.8 (3): 6 tick, giá trung bình 100.5; row [101, 102) = 4 tick; base do backend đã lọc theo min nên giữ nguyên
    expect(out.map((c) => [c.t, c.up, c.dn])).toEqual([[0, 4, 0], [60, 0, 3], [120, 4, 2], [120, 0, 4]]);
    expect(out[2].p).toBeCloseTo(100.5, 9);
    expect(out[3].p).toBe(101.5);
    // limit 2: giữ ô 6 và 4 (hai ô 4 tick: bằng nhau thì ô mới hơn), sắp theo thời gian
    expect(mergeLiveBig(base, [cells], 4, 2, 1).map((c) => [c.t, c.up + c.dn])).toEqual([[120, 6], [120, 4]]);
    // không gom giá (size 0): đúng từng giá; nhiều phút thì mỗi phút gom riêng
    expect(mergeLiveBig([], [live], 1, 10, 0)).toHaveLength(5);
    expect(mergeLiveBig([], [{ t: 60, cells: [[100.2, 1, 0]] }, { t: 120, cells: [[100.4, 1, 0]] }], 1, 10, 1).map((c) => c.t)).toEqual([60, 120]);
    expect(mergeLiveBig(base, [], 1, 10, 0)).toBe(base);
  });

  it("feed đọc DB tới `upTo` nhưng giữ khoá theo t1, và báo bản đang giữ đọc tới đâu", async () => {
    const calls: [number, number][] = [];
    const feed = new TickProfileFeed(async (_s, from, to, lay) => (calls.push([from, to]), { up: new Array(lay.N).fill(0), dn: new Array(lay.N).fill(0) }), () => {});
    const l = { lo: 0, hi: 2, size: 1, N: 2 };
    feed.get("S", 10, 600, l, "a", 120);
    expect(feed.heldUpTo("S", 10, 600, l)).toBeUndefined(); // chưa có dữ liệu
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([[10, 120]]);
    expect(feed.get("S", 10, 600, l, "a", 120)).not.toBeNull();
    expect(feed.heldUpTo("S", 10, 600, l)).toBe(120);
    // sang phút kế: đang đọc lại tới 180 nhưng bản giữ vẫn là bản tới 120
    feed.get("S", 10, 600, l, "b", 180);
    expect(feed.heldUpTo("S", 10, 600, l)).toBe(120);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls[1]).toEqual([10, 180]);
    expect(feed.heldUpTo("S", 10, 600, l)).toBe(180);
    const big = new TickBigFeed(async (_s, from, to) => (calls.push([from, to]), []), () => {});
    big.get("S", 10, 600, 1, 10, 0, "a", 180);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls[2]).toEqual([10, 180]);
    expect(big.heldUpTo("S", 10, 600, 1, 10, 0)).toBe(180);
  });
});
