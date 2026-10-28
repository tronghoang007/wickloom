import type { Bar, TickCell } from "@/lib/api";
import { describe, expect, it } from "vitest";
import { LIVE_KEEP, TickBigFeed, TickProfileFeed, TickStatFeed, addLiveHist, appendLive, coverSig, coversFrom, liveCut, liveFrom, liveHist, mergeLiveBig, overlapRatio, rebin, type LiveMinute, type TickHist } from "./tickProfile";

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

describe("TickStatFeed", () => {
  it("lần đầu null và nạp ngầm tới `upTo`; xong thì trả thống kê và báo onChange; cùng chữ ký không nạp lại, đổi chữ ký hoặc row giá thì nạp lại / khoá khác", async () => {
    const calls: [string, number, number, number][] = [];
    let changed = 0;
    const feed = new TickStatFeed(async (symbol, from, to, size) => (calls.push([symbol, from, to, size]), { n: 3, sum: 12, sumsq: 60 }), () => changed++);
    const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
    expect(feed.get("S", 10, 20, 0.5, "a", 15)).toBeNull();
    await settle();
    expect(changed).toBe(1);
    expect(feed.get("S", 10, 20, 0.5, "a", 15)).toEqual({ n: 3, sum: 12, sumsq: 60 });
    expect(calls).toEqual([["S", 10, 15, 0.5]]); // đọc tới `upTo`, không tới hết khoảng
    expect(feed.get("S", 10, 20, 0.5, "b", 15)).not.toBeNull(); // chữ ký đổi: bản cũ trong lúc nạp lại
    await settle();
    expect(calls).toHaveLength(2);
    expect(feed.get("S", 10, 20, 1, "b", 15)).toBeNull(); // row giá khác là khoá khác
  });

  it("khoảng dịch sang khối mới: dùng tạm thống kê của khoảng trùng nhiều trong lúc nạp; ít trùng hoặc row khác thì chưa có", async () => {
    const stat = { n: 3, sum: 12, sumsq: 60 };
    const feed = new TickStatFeed(async () => stat, () => {});
    const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
    feed.get("S", 0, 600, 0.5, "a");
    await settle();
    expect(feed.get("S", 100, 700, 0.5, "a")).toBe(stat); // trùng 500 / 700 ≈ 0.71
    expect(feed.get("S", 500, 1100, 0.5, "a")).toBeNull(); // trùng 100 / 1100
    expect(feed.get("S", 100, 700, 1, "a")).toBeNull(); // row giá khác
    await settle();
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

  it("t1 đổi (Replay bước thêm nến): dùng tạm bản của khoảng cùng đầu / ngưỡng / số ô / row cho tới khi nạp xong; lùi mốc thì bỏ các ô từ t1 trở đi", async () => {
    const calls: number[] = [];
    const feed = new TickBigFeed(async (_s, from, to, min) => (calls.push(to), [{ t: from, p: 1, up: min, dn: 0 }, { t: to - 60, p: 2, up: min, dn: 0 }] as TickCell[]), () => {});
    const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
    expect(feed.get("S", 0, 600, 3, 100, 0.5, "a")).toBeNull();
    await settle();
    const first = feed.get("S", 0, 600, 3, 100, 0.5, "a")!;
    expect(first.map((c) => c.t)).toEqual([0, 540]);
    // thêm một nến: khoá mới chưa có gì nhưng vẫn có bản cũ để vẽ; mốc DB của bản mượn là mốc của bản cũ
    expect(feed.get("S", 0, 660, 3, 100, 0.5, "b")).toBe(first);
    expect(feed.heldUpTo("S", 0, 660, 3, 100, 0.5)).toBe(600);
    await settle();
    expect(feed.get("S", 0, 660, 3, 100, 0.5, "b")!.map((c) => c.t)).toEqual([0, 600]); // nạp xong: bản đúng của khoá
    // mốc lùi về sớm hơn: mượn bản gần nhất (t1 = 600) nhưng bỏ ô từ 500 trở đi
    expect(feed.get("S", 0, 500, 3, 100, 0.5, "c")!.map((c) => c.t)).toEqual([0]);
    await settle();
    // đầu, ngưỡng khác hoặc t1 quá xa thì không mượn
    expect(feed.get("S", 60, 660, 3, 100, 0.5, "d")).toBeNull();
    expect(feed.get("S", 0, 660, 4, 100, 0.5, "d")).toBeNull();
    expect(feed.get("S", 0, 5000, 3, 100, 0.5, "d")).toBeNull();
    await settle();
  });

  it("lần nạp trước của khoá lỗi thì không mượn bản của khoảng khác", async () => {
    let n = 0;
    const feed = new TickBigFeed(async (_s, from, _to, min) => (++n === 1 ? [{ t: from, p: 1, up: min, dn: 0 } as TickCell] : null), () => {});
    const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
    feed.get("S", 0, 600, 3, 100, 0.5, "a");
    await settle();
    expect(feed.get("S", 0, 660, 3, 100, 0.5, "b")).not.toBeNull(); // đang nạp: mượn
    await settle(); // lần nạp này trả null (lỗi)
    expect(feed.get("S", 0, 660, 3, 100, 0.5, "b")).toBeNull();
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

  it("appendLive: phút mới thay phút cùng hoặc sau nó, chỉ giữ LIVE_KEEP phút cuối", () => {
    const m = (t: number, n = 1): LiveMinute => ({ t, cells: [[100, n, 0]] });
    expect(appendLive([], m(60))).toEqual([m(60)]);
    expect(appendLive([m(60), m(120)], m(120, 5))).toEqual([m(60), m(120, 5)]); // cùng phút: thay bằng bản mới
    expect(appendLive([m(60), m(120), m(180)], m(180, 2)).length).toBe(3);
    const full = [m(60), m(120), m(180)];
    expect(full.length).toBe(LIVE_KEEP);
    expect(appendLive(full, m(240)).map((l) => l.t)).toEqual([120, 180, 240]);
  });

  it("liveHist: bản DB tới đầu phút đang chạy + các phút bộ nhớ, không có phút đang chạy trong khoảng thì chỉ đọc DB", async () => {
    const calls: [number, number][] = [];
    const feed = new TickProfileFeed(async (_s, from, to) => (calls.push([from, to]), { up: [1, 0, 0], dn: [0, 0, 1] }), () => {});
    const cover = [td(0), td(60)];
    const lives: LiveMinute[] = [{ t: 60, cells: [[100.2, 1, 0]] }, { t: 120, cells: [[101.5, 0, 4]] }];
    expect(liveHist(feed, "S", cover, lives, 0, 600, l3)).toBeNull(); // DB chưa nạp: chưa có profile
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([[0, 120]]); // DB chỉ đọc tới đầu phút đang chạy
    // DB giữ tới 120: chỉ phút 120 còn thiếu (phút 60 đã nằm trong DB)
    expect(liveHist(feed, "S", cover, lives, 0, 600, l3)).toEqual({ up: [1, 0, 0], dn: [0, 4, 1] });
    // phút đang chạy ngoài khoảng: đọc hết t1, không cộng gì
    expect(liveHist(feed, "S", cover, lives, 0, 100, l3)).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls[1]).toEqual([0, 100]);
    expect(liveHist(feed, "S", cover, lives, 0, 100, l3)).toEqual({ up: [1, 0, 0], dn: [0, 0, 1] });
  });
});

describe("liveHist khi đang dùng tạm bản của profile khác", () => {
  const l3 = { lo: 100, hi: 103, size: 1, N: 3 };
  const mkFeed = () => new TickProfileFeed(async () => ({ up: [1, 0, 0], dn: [0, 0, 1] }), () => {});
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
  const cover = [td(0), td(60), td(120), td(180)];

  it("heldUpTo của khoá chưa nạp là mốc DB của bản mượn; nạp xong thì là mốc của chính nó", async () => {
    const feed = mkFeed();
    feed.get("S", 0, 600, l3, "a", 120);
    await settle();
    expect(feed.heldUpTo("S", 0, 700, l3)).toBe(120); // khoá t1 = 700 chưa có dữ liệu, mượn bản t1 = 600
    expect(feed.heldUpTo("S", 900, 1000, l3)).toBeUndefined(); // không có bản nào gần giống
    feed.get("S", 0, 700, l3, "a", 180);
    await settle();
    expect(feed.heldUpTo("S", 0, 700, l3)).toBe(180);
  });

  it("phút live cộng theo mốc DB của bản mượn: phút nằm giữa hai mốc không mất", async () => {
    const feed = mkFeed();
    const early: LiveMinute[] = [{ t: 120, cells: [[101.5, 0, 4]] }];
    liveHist(feed, "S", cover, early, 0, 600, l3); // bản đầu đọc DB tới 120
    await settle();
    // phút 120 đã chốt, phút 180 đang chạy; khoá mới (t1 khác) chưa nạp xong: cut mới = 180 nhưng bản mượn mới đọc tới 120
    const lives: LiveMinute[] = [{ t: 120, cells: [[101.5, 0, 4]] }, { t: 180, cells: [[100.2, 2, 0]] }];
    expect(liveHist(feed, "S", cover, lives, 0, 700, l3)).toEqual({ up: [3, 0, 0], dn: [0, 4, 1] });
  });

  it("phút đang chạy đã nằm trong bản mượn (đọc tới t1) thì không cộng hai lần", async () => {
    const feed = mkFeed();
    liveHist(feed, "S", cover, [], 0, 600, l3); // không có phút live: đọc hết t1 = 600
    await settle();
    const lives: LiveMinute[] = [{ t: 180, cells: [[100.2, 2, 0]] }];
    // khoá mới có phút live 180 (cut = 180) nhưng bản mượn đã đọc tới 600, gồm cả phút 180
    expect(liveHist(feed, "S", cover, lives, 0, 700, l3)).toEqual({ up: [1, 0, 0], dn: [0, 0, 1] });
  });

  it("chia lại bản mượn một lần cho mỗi bản nguồn, không chia lại mỗi lần vẽ", async () => {
    const feed = mkFeed();
    feed.get("S", 0, 600, { lo: 100, hi: 103, size: 1, N: 3 }, "a");
    await settle();
    const taller = { lo: 100, hi: 104, size: 1, N: 4 };
    const a = feed.get("S", 0, 700, taller, "a");
    expect(feed.get("S", 0, 700, taller, "a")).toBe(a);
  });
});

describe("rebin / overlapRatio", () => {
  const sum = (h: TickHist) => [h.up.reduce((a, b) => a + b, 0), h.dn.reduce((a, b) => a + b, 0)];

  it("cùng row: trả nguyên bản; thêm row ở đáy cùng cỡ: volume nằm đúng giá", () => {
    const h = { up: [1, 2], dn: [3, 4] };
    expect(rebin(h, lay, lay)).toBe(h);
    // lay: [100,105) [105,110); thêm một row dưới: [95,100) [100,105) [105,110)
    expect(rebin(h, lay, { lo: 95, hi: 110, size: 5, N: 3 })).toEqual({ up: [0, 1, 2], dn: [0, 3, 4] });
  });

  it("row to hơn gộp, row nhỏ hơn chia theo phần chồng, tổng volume giữ nguyên", () => {
    const h = { up: [4, 8], dn: [2, 6] }; // [100,105) [105,110)
    expect(rebin(h, lay, { lo: 100, hi: 110, size: 10, N: 1 })).toEqual({ up: [12], dn: [8] });
    expect(rebin(h, lay, { lo: 100, hi: 110, size: 2.5, N: 4 })).toEqual({ up: [2, 2, 4, 4], dn: [1, 1, 3, 3] });
    const odd = rebin(h, lay, { lo: 101, hi: 111, size: 3, N: 3 });
    expect(sum(odd)[0]).toBeCloseTo(12);
    expect(sum(odd)[1]).toBeCloseTo(8);
  });

  it("phần nằm ngoài vùng giá mới dồn vào row đầu / cuối", () => {
    const h = { up: [5, 7], dn: [0, 0] };
    expect(rebin(h, lay, { lo: 105, hi: 110, size: 5, N: 1 })).toEqual({ up: [12], dn: [0] }); // row dưới nằm ngoài -> dồn vào row duy nhất
    expect(rebin(h, lay, { lo: 105, hi: 115, size: 5, N: 2 })).toEqual({ up: [5 + 7, 0], dn: [0, 0] });
  });

  it("overlapRatio: phần chung / phần hợp", () => {
    expect(overlapRatio(0, 100, 0, 100)).toBe(1);
    expect(overlapRatio(0, 100, 0, 110)).toBeCloseTo(100 / 110);
    expect(overlapRatio(0, 100, 100, 200)).toBe(0);
    expect(overlapRatio(0, 0, 0, 0)).toBe(0);
  });
});

describe("TickProfileFeed: dùng tạm bản của profile gần giống", () => {
  const mk = () => {
    let release: (() => void)[] = [];
    const feed = new TickProfileFeed((_s, _f, _t, l) => new Promise<TickHist | null>((res) => release.push(() => res({ up: new Array(l.N).fill(1), dn: new Array(l.N).fill(2) }))), () => {});
    return { feed, flush: async () => { const r = release; release = []; r.forEach((f) => f()); await Promise.resolve(); await Promise.resolve(); } };
  };
  const wide = { lo: 100, hi: 120, size: 5, N: 4 };

  it("phiên dài thêm một nến: trong lúc nạp trả bản cũ, nạp xong trả bản mới", async () => {
    const { feed, flush } = mk();
    feed.get("S", 0, 900, wide, "a");
    await flush();
    const grown = feed.get("S", 0, 1000, wide, "a"); // khoá mới (t1 đổi), chưa có dữ liệu
    expect(grown).toEqual({ up: [1, 1, 1, 1], dn: [2, 2, 2, 2] });
    await flush();
    expect(feed.get("S", 0, 1000, wide, "a")).toEqual({ up: [1, 1, 1, 1], dn: [2, 2, 2, 2] });
  });

  it("thêm đỉnh mới đổi layout: bản cũ được chia lại sang N mới (đủ độ dài)", async () => {
    const { feed, flush } = mk();
    feed.get("S", 0, 900, wide, "a");
    await flush();
    const taller = { lo: 100, hi: 125, size: 5, N: 5 };
    const h = feed.get("S", 0, 900, taller, "a");
    expect(h?.up).toEqual([1, 1, 1, 1, 0]);
    expect(h?.dn).toEqual([2, 2, 2, 2, 0]);
  });

  it("khoảng thời gian khác hẳn hoặc symbol khác: không dùng tạm", async () => {
    const { feed, flush } = mk();
    feed.get("S", 0, 900, wide, "a");
    await flush();
    expect(feed.get("S", 900, 1000, wide, "a")).toBeNull(); // liền kề, không trùng
    expect(feed.get("T", 0, 900, wide, "a")).toBeNull(); // symbol khác
    expect(feed.get("S", 0, 1000, wide, "a")).not.toBeNull();
  });

  it("lần nạp của khoá mới lỗi thì thôi dùng tạm (rơi về nến) tới khi thử lại", async () => {
    let fail = false;
    let clock = 0;
    const pending: (() => void)[] = [];
    const feed = new TickProfileFeed(
      (_s, _f, _t, l) => new Promise<TickHist | null>((res) => pending.push(() => res(fail ? null : { up: new Array(l.N).fill(1), dn: new Array(l.N).fill(0) }))),
      () => {},
      () => clock,
    );
    feed.get("S", 0, 900, wide, "a");
    pending.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    fail = true;
    expect(feed.get("S", 0, 1000, wide, "a")).not.toBeNull(); // đang nạp: dùng tạm
    pending.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    expect(feed.get("S", 0, 1000, wide, "a")).toBeNull(); // lỗi
    clock += 11_000;
    expect(feed.get("S", 0, 1000, wide, "a")).not.toBeNull(); // thử lại: lại dùng tạm
  });
});
