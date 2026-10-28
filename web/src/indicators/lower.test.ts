import type { Bar } from "@/lib/api";
import { describe, expect, it, vi } from "vitest";
import { LOWER_TFS, LowerFeed, TICK_TF, autoLowerTf, capBars, lowerCandidates, mergeSources, stepOf, withinBudget } from "./lower";

const bar = (t: number, c = 1, v = 1): Bar => ({ t, o: c, h: c, l: c, c, v });
const run = (tf: string, from: number, count: number): Bar[] => Array.from({ length: count }, (_, i) => bar(from + i * ({ M1: 60, M5: 300 }[tf] ?? 60), i));

describe("capBars", () => {
  it("không có nến nào từ mốc `to` trở đi -> trả lại đúng mảng (không sao chép)", () => {
    const a = run("M1", 1000, 5); // 1000..1240
    expect(capBars(a, 1300)).toBe(a);
    expect(capBars([], 1300)).toEqual([]);
  });
  it("Replay: bỏ các nến bắt đầu từ `to` trở đi", () => {
    const a = run("M1", 1000, 5);
    expect(capBars(a, 1120).map((b) => b.t)).toEqual([1000, 1060]);
    expect(capBars(a, 1000)).toEqual([]);
    expect(capBars(a, 1001).map((b) => b.t)).toEqual([1000]);
  });
});

describe("mergeSources", () => {
  it("khung thô chỉ lấy nến nằm hoàn toàn trước chỗ khung mịn bắt đầu", () => {
    const fine = { tf: "M1", step: 60, bars: run("M1", 1000, 5) }; // 1000..1240
    const coarse = { tf: "M5", step: 300, bars: run("M5", 0, 5) }; // 0, 300, 600, 900, 1200
    const merged = mergeSources([fine, coarse]);
    // M5 900 phủ 900..1200 > 1000 nên bị bỏ (đã có M1 trong đó); 1200 nằm sau
    expect(merged.map((b) => b.t)).toEqual([0, 300, 600, 1000, 1060, 1120, 1180, 1240]);
  });
  it("nguồn rỗng bị bỏ qua; ba tầng khung", () => {
    const a = { tf: "M1", step: 60, bars: run("M1", 10_000, 3) };
    const b = { tf: "M5", step: 300, bars: [] };
    const c = { tf: "M15", step: 900, bars: [bar(0), bar(900), bar(9000), bar(9900)] };
    expect(mergeSources([a, b, c]).map((x) => x.t)).toEqual([0, 900, 9000, 10_000, 10_060, 10_120]);
  });
  it("lỗ hổng trong dữ liệu mịn được lấp bằng khung thô", () => {
    // M1 có 3000..3060 rồi nhảy tới 3600; M5 phủ 3000..4500 (3000, 3300, 3600, 3900, 4200)
    const fine = { tf: "M1", step: 60, bars: [bar(3000, 1), bar(3060, 2), bar(3600, 3), bar(3660, 4)] };
    const coarse = { tf: "M5", step: 300, bars: [3000, 3300, 3600, 3900, 4200].map((t) => bar(t, 9)) };
    const merged = mergeSources([fine, coarse]);
    // 3000 và 3600 có M1 bên trong nên bỏ; 3300 (lỗ hổng) và 3900, 4200 (sau dữ liệu mịn) lấy
    expect(merged.map((b) => [b.t, b.c])).toEqual([[3000, 1], [3060, 2], [3300, 9], [3600, 3], [3660, 4], [3900, 9], [4200, 9]]);
  });
  it("không có nguồn: rỗng", () => {
    expect(mergeSources([])).toEqual([]);
  });
});

describe("chọn khung", () => {
  it("lowerCandidates: từ khung đầu trở lên, chỉ nhỏ hơn khung chart", () => {
    expect(lowerCandidates(900, "M1")).toEqual(["M1", "M5"]);
    expect(lowerCandidates(3600, "M5")).toEqual(["M5", "M15", "M30"]);
    expect(lowerCandidates(60, "M1")).toEqual([]);
    expect(lowerCandidates(86400, "H1")).toEqual(["H1", "H4"]);
  });
  it("autoLowerTf như script CVD", () => {
    expect(autoLowerTf(900)).toBe("M1");
    expect(autoLowerTf(86400)).toBe("M5");
    expect(autoLowerTf(7 * 86400)).toBe("H1");
  });
  it("withinBudget bỏ khung mịn vượt ngân sách nến", () => {
    expect(withinBudget(["M1", "M5", "M15"], 0, 60 * 1000, 2000)).toEqual(["M1", "M5", "M15"]);
    expect(withinBudget(["M1", "M5", "M15"], 0, 60 * 5000, 2000)).toEqual(["M5", "M15"]);
    expect(withinBudget(["M1"], 0, 60 * 5000, 2000)).toEqual([]);
  });
  it("danh sách khung nhỏ mịn → thô", () => {
    expect([...LOWER_TFS]).toEqual(["M1", "M5", "M15", "M30", "H1", "H4", "D1"]);
  });
});

// Nguồn giả như backend: tối đa `limit` nến MỚI NHẤT trong [from, to)
function fakeDb(data: Record<string, Bar[]>) {
  const calls: { tf: string; from: number; to: number; limit: number }[] = [];
  const fetch = async (_s: string, tf: string, from: number, to: number, limit: number) => {
    calls.push({ tf, from, to, limit });
    return (data[tf] ?? []).filter((b) => b.t >= from && b.t < to).slice(-limit);
  };
  return { calls, fetch, data };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("LowerFeed", () => {
  it("lần đầu rỗng rồi nạp ngầm, xong thì báo onChange và trả nến", async () => {
    const db = fakeDb({ M1: run("M1", 0, 10) });
    const onChange = vi.fn();
    const feed = new LowerFeed(db.fetch, onChange, { now: () => 0 });
    expect(feed.get("X", { tfs: ["M1"], from: 0 }, 600)).toEqual([]);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(feed.get("X", { tfs: ["M1"], from: 0 }, 600)).toHaveLength(10);
    expect(db.calls).toHaveLength(1);
  });

  it("phân trang lùi khi nhiều hơn một trang", async () => {
    const db = fakeDb({ M1: run("M1", 0, 10) });
    const feed = new LowerFeed(db.fetch, () => {}, { now: () => 0, pageSize: 4 });
    feed.get("X", { tfs: ["M1"], from: 0 }, 600);
    await flush();
    expect(feed.get("X", { tfs: ["M1"], from: 0 }, 600).map((b) => b.t)).toEqual(run("M1", 0, 10).map((b) => b.t));
    expect(db.calls.map((c) => [c.from, c.to])).toEqual([[0, 600], [0, 360], [0, 120]]); // 4 + 4 + 2
  });

  it("cuộn trái (from nhỏ hơn) chỉ nạp phần cũ thêm", async () => {
    const db = fakeDb({ M1: run("M1", 0, 20) });
    const feed = new LowerFeed(db.fetch, () => {}, { now: () => 0 });
    feed.get("X", { tfs: ["M1"], from: 600 }, 1200);
    await flush();
    expect(feed.get("X", { tfs: ["M1"], from: 600 }, 1200)).toHaveLength(10);
    feed.get("X", { tfs: ["M1"], from: 0 }, 1200);
    await flush();
    expect(feed.get("X", { tfs: ["M1"], from: 0 }, 1200)).toHaveLength(20);
    expect(db.calls[1]).toMatchObject({ from: 0, to: 600 });
  });

  it("DB không có dữ liệu ở vùng cũ: không nạp lại mãi", async () => {
    const db = fakeDb({ M1: run("M1", 600, 5) });
    const feed = new LowerFeed(db.fetch, () => {}, { now: () => 0 });
    for (let i = 0; i < 3; i++) {
      feed.get("X", { tfs: ["M1"], from: 0 }, 900);
      await flush();
    }
    expect(db.calls).toHaveLength(1);
  });

  it("ghép nhiều khung: M1 chỗ có, M5 cho vùng cũ", async () => {
    const db = fakeDb({ M1: run("M1", 3000, 5), M5: run("M5", 0, 20) }); // M1 từ 3000; M5 0..5700
    const feed = new LowerFeed(db.fetch, () => {}, { now: () => 0 });
    const need = { tfs: ["M1", "M5"], from: 0 };
    feed.get("X", need, 6000);
    await flush();
    const merged = feed.get("X", need, 6000);
    expect(merged.filter((b) => b.t < 3000).every((b, i, a) => i === 0 || b.t - a[i - 1].t === 300)).toBe(true);
    expect(merged.some((b) => b.t === 3000)).toBe(true);
    expect(merged.some((b) => b.t === 2700)).toBe(true); // M5 2700..3000 hết đúng chỗ M1 bắt đầu
    expect(merged.some((b) => b.t === 3000 && b.c === 0)).toBe(true); // từ 3000 là M1 (c = 0 ở nến đầu của run M1)
  });

  it("làm mới đuôi sau 15 giây: thay nến cuối bằng bản mới, chỉ báo khi có thay đổi", async () => {
    let now = 0;
    const m1 = run("M1", 0, 5);
    const db = fakeDb({ M1: m1 });
    const onChange = vi.fn();
    const feed = new LowerFeed(db.fetch, onChange, { now: () => now });
    feed.get("X", { tfs: ["M1"], from: 0 }, 300);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);

    now = 5_000; // chưa tới 15s: không nạp
    feed.get("X", { tfs: ["M1"], from: 0 }, 300);
    await flush();
    expect(db.calls).toHaveLength(1);

    now = 16_000; // tới hạn nhưng không có gì mới: nạp đuôi, không onChange
    feed.get("X", { tfs: ["M1"], from: 0 }, 300);
    await flush();
    expect(db.calls).toHaveLength(2);
    expect(db.calls[1]).toMatchObject({ from: 240, limit: 50000 });
    expect(onChange).toHaveBeenCalledTimes(1);

    db.data.M1[4] = { ...db.data.M1[4], c: 99, v: 50 }; // nến cuối chạy tiếp + nến mới
    db.data.M1.push(bar(300, 7));
    now = 32_000;
    feed.get("X", { tfs: ["M1"], from: 0 }, 360);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(2);
    const bars = feed.get("X", { tfs: ["M1"], from: 0 }, 360);
    expect(bars).toHaveLength(6);
    expect(bars[4]).toMatchObject({ c: 99, v: 50 });
  });

  it("khoảng đã qua từ lâu (FRVP đã đóng): không làm mới đuôi mỗi 15 giây, nhưng khoảng chạm tới hiện tại thì có", async () => {
    let now = 1_700_000_000_000; // ms: [0, 300) giây cách xa hiện tại
    const db = fakeDb({ M1: run("M1", 0, 5) });
    const feed = new LowerFeed(db.fetch, () => {}, { now: () => now });
    feed.get("X", { tfs: ["M1"], from: 0 }, 300);
    await flush();
    now += 16_000;
    feed.get("X", { tfs: ["M1"], from: 0 }, 300);
    await flush();
    expect(db.calls).toHaveLength(1);

    const live = new LowerFeed(db.fetch, () => {}, { now: () => now });
    const to = Math.ceil(now / 1000) + 60; // nến cuối đang chạy
    live.get("Y", { tfs: ["M1"], from: 0 }, to);
    await flush();
    const before = db.calls.length;
    now += 16_000;
    live.get("Y", { tfs: ["M1"], from: 0 }, to);
    await flush();
    expect(db.calls.length).toBe(before + 1);
  });

  it("lỗi mạng: thử lại sau 10 giây, không ném", async () => {
    let now = 0;
    let fail = true;
    const fetch = vi.fn(async () => {
      if (fail) throw new Error("net");
      return run("M1", 0, 3);
    });
    const feed = new LowerFeed(fetch, () => {}, { now: () => now });
    feed.get("X", { tfs: ["M1"], from: 0 }, 300);
    await flush();
    now = 5_000;
    feed.get("X", { tfs: ["M1"], from: 0 }, 300);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    fail = false;
    now = 11_000;
    feed.get("X", { tfs: ["M1"], from: 0 }, 300);
    await flush();
    expect(feed.get("X", { tfs: ["M1"], from: 0 }, 300)).toHaveLength(3);
  });

  it("symbol khác có cache riêng", async () => {
    const db = fakeDb({ M1: run("M1", 0, 3) });
    const feed = new LowerFeed(db.fetch, () => {}, { now: () => 0 });
    feed.get("A", { tfs: ["M1"], from: 0 }, 300);
    feed.get("B", { tfs: ["M1"], from: 0 }, 300);
    await flush();
    expect(db.calls).toHaveLength(2);
  });
});

// EA giả: nạp vào "DB" `count` nến mới nhất của broker có t <= before (nến neo cũng được gửi lại, như EA thật)
function fakeEa(db: ReturnType<typeof fakeDb>, broker: Record<string, Bar[]>, opts: { refuse?: boolean } = {}) {
  const calls: { tf: string; count: number; before: number }[] = [];
  const backfill = async (_s: string, tf: string, count: number, before: number) => {
    calls.push({ tf, count, before });
    if (opts.refuse) return false;
    const sent = (broker[tf] ?? []).filter((b) => b.t <= before).slice(-count);
    const have = new Map((db.data[tf] ?? []).map((b) => [b.t, b]));
    for (const b of sent) have.set(b.t, b);
    db.data[tf] = [...have.values()].sort((a, b) => a.t - b.t);
    return true;
  };
  return { calls, backfill };
}

// Như manager: gọi get() mỗi lần có thay đổi (onChange) hoặc sau một lúc, cho tới khi không còn lần xin EA nào mới
async function drive(feed: LowerFeed, clock: { now: number }, need: { tfs: string[]; from: number }, to: number, calls: unknown[]) {
  let quiet = 0;
  for (let i = 0; i < 60 && quiet < 3; i++) {
    const before = calls.length;
    feed.get("X", need, to);
    await flush(); // đọc DB / làm mới đuôi
    feed.get("X", need, to);
    await flush(); // xin EA
    clock.now += 31_000; // qua thời gian chờ giữa hai lần xin
    quiet = calls.length === before ? quiet + 1 : 0;
  }
  return feed.get("X", need, to);
}

describe("LowerFeed xin EA nạp thêm", () => {
  const sleep = async () => {};
  const mk = (data: Record<string, Bar[]>, broker: Record<string, Bar[]>, extra: { refuse?: boolean; chunk?: number; tickChunk?: number } = {}) => {
    const db = fakeDb(data);
    const ea = fakeEa(db, broker, extra);
    const clock = { now: 0 };
    const onChange = vi.fn();
    const feed = new LowerFeed(db.fetch, onChange, { now: () => clock.now, backfill: ea.backfill, sleep, ...(extra.chunk ? { chunk: extra.chunk } : {}), ...(extra.tickChunk ? { tickChunk: extra.tickChunk } : {}) });
    return { db, ea, clock, onChange, feed };
  };

  it("DB thiếu đầu: xin EA nạp lùi từ nến đầu, rồi dùng được", async () => {
    const { ea, clock, feed } = mk({ M1: run("M1", 3000, 10) }, { M1: run("M1", 0, 100) });
    const out = await drive(feed, clock, { tfs: ["M1"], from: 0 }, 4000, ea.calls);
    expect(ea.calls[0]).toEqual({ tf: "M1", count: 100, before: 3000 }); // 50 nến thiếu + 50 dư
    expect(out[0].t).toBe(0);
    expect(out).toHaveLength(60); // 0..3540: 50 nến nạp thêm + 10 đã có
    expect(ea.calls).toHaveLength(1);
  });

  it("hai feed dùng chung hàm backfill: cùng một chỗ thiếu chỉ xin EA một lần, feed sau đọc luôn dữ liệu feed trước vừa lấp", async () => {
    const db = fakeDb({ M1: run("M1", 3000, 10) });
    const ea = fakeEa(db, { M1: run("M1", 0, 100) });
    const clock = { now: 0 };
    const mkFeed = () => new LowerFeed(db.fetch, vi.fn(), { now: () => clock.now, backfill: ea.backfill, sleep });
    const a = mkFeed();
    const b = mkFeed();
    const need = { tfs: ["M1"], from: 0 };
    a.get("X", need, 4000);
    b.get("X", need, 4000);
    await flush(); // cả hai đọc DB khi còn thiếu đầu
    const outA = await drive(a, clock, need, 4000, ea.calls);
    const outB = await drive(b, clock, need, 4000, ea.calls);
    expect(outA).toHaveLength(60);
    expect(outB).toHaveLength(60);
    expect(ea.calls).toHaveLength(1);
  });

  it("hai feed xin cùng lúc: xin EA lần lượt, không chồng nhau", async () => {
    const db = fakeDb({ M1: run("M1", 3000, 10) });
    const log: string[] = [];
    let active = 0;
    let overlap = false;
    const backfill = async (_s: string, tf: string, count: number, before: number) => {
      active++;
      overlap ||= active > 1;
      log.push(`${tf}:${before}`);
      await flush();
      db.data[tf] = run("M1", 0, 100).filter((b) => b.t <= before).slice(-count).concat((db.data[tf] ?? []).filter((b) => b.t > before - 1));
      db.data[tf] = [...new Map(db.data[tf].map((b) => [b.t, b])).values()].sort((x, y) => x.t - y.t);
      active--;
      return true;
    };
    const clock = { now: 0 };
    const feeds = [0, 1].map(() => new LowerFeed(db.fetch, vi.fn(), { now: () => clock.now, backfill, sleep }));
    const need = { tfs: ["M1"], from: 0 };
    feeds.forEach((f) => f.get("X", need, 4000));
    await flush();
    feeds.forEach((f) => f.get("X", need, 4000)); // cả hai cùng thấy thiếu đầu và cùng xin
    for (let i = 0; i < 6; i++) {
      await flush();
      clock.now += 31_000;
      feeds.forEach((f) => f.get("X", need, 4000));
    }
    expect(overlap).toBe(false);
    expect(log).toEqual(["M1:3000"]); // feed thứ hai dùng luôn kết quả của feed thứ nhất
  });

  it("thiếu nhiều hơn một chunk: nối nhiều lần xin cho tới khi đủ", async () => {
    const { ea, clock, feed } = mk({ M1: run("M1", 3000, 10) }, { M1: run("M1", 0, 100) }, { chunk: 20 });
    const out = await drive(feed, clock, { tfs: ["M1"], from: 0 }, 4000, ea.calls);
    expect(out[0].t).toBe(0);
    expect(out).toHaveLength(60); // 0..3540: 50 nến nạp thêm + 10 đã có
    expect(ea.calls.length).toBeGreaterThan(2);
    expect(ea.calls.every((c) => c.count <= 20)).toBe(true);
  });

  it("broker không có thêm: thử đúng hai lần rồi thôi (không lặp mãi)", async () => {
    const { ea, clock, feed } = mk({ M1: run("M1", 3000, 10) }, { M1: run("M1", 3000, 10) });
    await drive(feed, clock, { tfs: ["M1"], from: 0 }, 4000, ea.calls);
    expect(ea.calls).toHaveLength(2);
    await drive(feed, clock, { tfs: ["M1"], from: 0 }, 4000, ea.calls);
    expect(ea.calls).toHaveLength(2);
  });

  it("giữa hai lần xin phải chờ 30 giây", async () => {
    const { ea, clock, feed } = mk({ M1: run("M1", 3000, 10) }, { M1: run("M1", 3000, 10) });
    const need = { tfs: ["M1"], from: 0 };
    const step = async () => {
      feed.get("X", need, 4000);
      await flush();
      feed.get("X", need, 4000);
      await flush();
    };
    await step(); // đọc DB rồi xin lần 1, không có gì
    expect(ea.calls).toHaveLength(1);
    clock.now = 10_000;
    await step();
    expect(ea.calls).toHaveLength(1);
    clock.now = 31_000;
    await step();
    expect(ea.calls).toHaveLength(2);
  });

  it("backend từ chối: tính một lần thử, không ném", async () => {
    const { ea, clock, feed, onChange } = mk({ M1: run("M1", 3000, 10) }, {}, { refuse: true });
    const out = await drive(feed, clock, { tfs: ["M1"], from: 0 }, 4000, ea.calls);
    expect(out).toHaveLength(10);
    expect(ea.calls).toHaveLength(2);
    expect(onChange).toHaveBeenCalled();
  });

  it("DB rỗng: xin nến mới nhất tới `to`", async () => {
    const { ea, clock, feed } = mk({}, { M1: run("M1", 0, 100) });
    const out = await drive(feed, clock, { tfs: ["M1"], from: 3000 }, 6000, ea.calls);
    expect(ea.calls[0]).toMatchObject({ tf: "M1", before: 6000 });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].t).toBeLessThanOrEqual(3000);
  });

  it("DB rỗng: đọc xong phải báo onChange để manager tính lại và xin EA (không chờ tick nào)", async () => {
    const { ea, feed, onChange } = mk({}, { M1: run("M1", 0, 100) });
    const need = { tfs: ["M1"], from: 3000 };
    onChange.mockImplementation(() => feed.get("X", need, 6000)); // như manager: chỉ tính lại khi có onChange
    feed.get("X", need, 6000);
    await flush();
    await flush();
    expect(onChange).toHaveBeenCalled();
    expect(ea.calls[0]).toMatchObject({ tf: "M1", before: 6000 });
  });

  it("lỗ hổng mà khung thô có nến trong đó: xin EA lấp; chỗ nghỉ thì không xin", async () => {
    const m1 = run("M1", 0, 5).concat(run("M1", 3600, 5)); // 0..240, 3600..3840
    const m5 = run("M5", 0, 14); // phủ liên tục: thị trường mở lúc đó
    const open = mk({ M1: m1, M5: m5 }, { M1: run("M1", 0, 70) });
    const out = await drive(open.feed, open.clock, { tfs: ["M1", "M5"], from: 0 }, 4000, open.ea.calls);
    expect(open.ea.calls).toEqual([{ tf: "M1", count: 65, before: 3600 }]); // 55 nến thiếu + 10 dư
    expect(out.filter((b) => b.t >= 300 && b.t < 3600)).toHaveLength(55);

    const closed = mk({ M1: m1, M5: run("M5", 0, 1).concat(run("M5", 3600, 3)) }, { M1: run("M1", 0, 70) });
    await drive(closed.feed, closed.clock, { tfs: ["M1", "M5"], from: 0 }, 4000, closed.ea.calls);
    expect(closed.ea.calls).toEqual([]);
  });

  it("khung mịn hết đường (broker không có) thì mới xin đầu của khung thô hơn", async () => {
    const { ea, clock, feed } = mk({ M1: run("M1", 3000, 10), M5: run("M5", 2400, 10) }, { M1: run("M1", 3000, 10), M5: run("M5", 0, 40) });
    const out = await drive(feed, clock, { tfs: ["M1", "M5"], from: 0 }, 5400, ea.calls);
    expect(ea.calls.map((c) => c.tf)).toEqual(["M1", "M1", "M5"]);
    expect(out[0].t).toBe(0); // vùng cũ do M5 phủ
  });

  it("khung mịn nạp được đủ thì không xin khung thô hơn", async () => {
    const { ea, clock, feed } = mk({ M1: run("M1", 3000, 10), M5: run("M5", 2400, 10) }, { M1: run("M1", 0, 100), M5: run("M5", 0, 40) });
    await drive(feed, clock, { tfs: ["M1", "M5"], from: 0 }, 5400, ea.calls);
    expect(ea.calls.map((c) => c.tf)).toEqual(["M1"]);
  });

  it("chỉ một lần xin tại một thời điểm", async () => {
    const { ea, feed } = mk({ M1: run("M1", 3000, 10) }, { M1: run("M1", 0, 100) });
    const need = { tfs: ["M1"], from: 0 };
    feed.get("X", need, 4000);
    await flush();
    feed.get("X", need, 4000);
    feed.get("X", need, 4000);
    feed.get("X", need, 4000);
    await flush();
    expect(ea.calls).toHaveLength(1);
  });

  it("không cấu hình backfill: chỉ đọc DB", async () => {
    const db = fakeDb({ M1: run("M1", 3000, 10) });
    const feed = new LowerFeed(db.fetch, () => {}, { now: () => 0 });
    for (let i = 0; i < 3; i++) {
      feed.get("X", { tfs: ["M1"], from: 0 }, 4000);
      await flush();
    }
    expect(feed.get("X", { tfs: ["M1"], from: 0 }, 4000)).toHaveLength(10);
    expect(db.calls).toHaveLength(1);
  });
  it("khung tick TD: bước 60s, xin theo từng đoạn tickChunk nến M1, chờ lâu hơn", async () => {
    expect(stepOf(TICK_TF)).toBe(60);
    expect(stepOf("M5")).toBe(300);
    const { ea, clock, feed } = mk({ TD: run("M1", 3000, 10) }, { TD: run("M1", 0, 100) }, { tickChunk: 20 });
    const out = await drive(feed, clock, { tfs: [TICK_TF], from: 0 }, 4000, ea.calls);
    expect(out[0].t).toBe(0);
    expect(out.length).toBeGreaterThanOrEqual(60); // 0..3540 + vài phút đuôi do EA gửi khi làm mới đuôi
    const heads = ea.calls.filter((c) => c.count !== 3); // count 3 = làm mới đuôi
    expect(heads.length).toBeGreaterThan(2);
    expect(heads.every((c) => c.tf === "TD" && c.count <= 20)).toBe(true);
  });

  describe("lỗ giữa dữ liệu tick TD (M1 làm khung chuẩn)", () => {
    const need = { tfs: [TICK_TF], from: 0 };
    const holeCalls = (ea: { calls: { tf: string; count: number; before: number }[] }) => ea.calls.filter((c) => c.tf === "TD" && c.count !== 3); // count 3 = làm mới đuôi
    const all = run("M1", 0, 40); // phút 0..39
    const tdWith = (...missing: [number, number][]) => all.filter((b, i) => !missing.some(([a, z]) => i >= a && i < z)); // bỏ các đoạn phút [a, z)
    const moving = (bs: Bar[]) => bs.map((b) => ({ ...b, h: b.c + 1 })); // nến M1 có đổi giá trong phút: chỉ loại nến này mới chứng tỏ TD thiếu thật

    it("thị trường mở (M1 có nến trong chỗ trống) mà TD thiếu: xin EA đúng khoảng thiếu rồi lấp", async () => {
      const { ea, clock, feed } = mk({ TD: tdWith([10, 30]), M1: moving(all) }, { TD: all });
      const out = await drive(feed, clock, need, 2400, ea.calls);
      expect(holeCalls(ea)[0]).toEqual({ tf: "TD", count: 30, before: 1800 }); // 20 phút thiếu + 10 dư, neo ở phút đầu tiên sau lỗ
      expect(out.map((b) => b.t)).toEqual(all.map((b) => b.t)); // lấp kín, M1 không lẫn vào kết quả
      expect(holeCalls(ea)).toHaveLength(1);
    });

    it("lỗ nhiều: lấp từ mới tới cũ, mỗi lỗ một lần xin", async () => {
      const { ea, clock, feed } = mk({ TD: tdWith([5, 12], [20, 28]), M1: moving(all) }, { TD: all });
      const out = await drive(feed, clock, need, 2400, ea.calls);
      expect(holeCalls(ea).map((c) => c.before)).toEqual([28 * 60, 12 * 60]);
      expect(out).toHaveLength(40);
    });

    it("thị trường nghỉ (M1 cũng không có nến trong chỗ trống): không xin", async () => {
      const m1 = tdWith([10, 30]);
      const { ea, clock, feed } = mk({ TD: tdWith([10, 30]), M1: moving(m1) }, { TD: all });
      await drive(feed, clock, need, 2400, ea.calls);
      expect(holeCalls(ea)).toEqual([]);
    });

    it("nến M1 trong chỗ trống phẳng (phút chỉ có tick cùng giá, EA không gửi gì): không xin; có biến động giá mới xin", async () => {
      const flat = mk({ TD: tdWith([10, 30]), M1: all }, { TD: all });
      await drive(flat.feed, flat.clock, need, 2400, flat.ea.calls);
      expect(holeCalls(flat.ea)).toEqual([]);
      // chỉ một phút trong chỗ trống có biến động giá cũng đủ chứng tỏ TD thiếu thật
      const part = mk({ TD: tdWith([10, 30]), M1: all.map((b, i) => (i === 20 ? { ...b, h: b.c + 1 } : b)) }, { TD: all });
      await drive(part.feed, part.clock, need, 2400, part.ea.calls);
      expect(holeCalls(part.ea)).toHaveLength(1);
    });

    it("lỗ dưới 3 phút (phút chỉ có tick cùng giá không có nến TD): không xin", async () => {
      const { ea, clock, feed } = mk({ TD: tdWith([10, 12], [20, 23]), M1: moving(all) }, { TD: all });
      await drive(feed, clock, need, 2400, ea.calls);
      expect(holeCalls(ea).map((c) => c.before)).toEqual([23 * 60]); // lỗ 3 phút thì xin, lỗ 2 phút thì không
    });

    it("broker không có tick ở đó: thử đúng hai lần rồi thôi", async () => {
      const { ea, clock, feed } = mk({ TD: tdWith([10, 30]), M1: moving(all) }, { TD: tdWith([10, 30]) });
      await drive(feed, clock, need, 2400, ea.calls);
      expect(holeCalls(ea)).toHaveLength(2);
    });

    it("không cấu hình backfill: không đọc M1 chuẩn", async () => {
      const db = fakeDb({ TD: tdWith([10, 30]), M1: moving(all) });
      const feed = new LowerFeed(db.fetch, () => {}, { now: () => 0 });
      for (let i = 0; i < 3; i++) {
        feed.get("X", need, 2400);
        await flush();
      }
      expect(db.calls.every((c) => c.tf === "TD")).toBe(true);
    });

    it("khung thường (một khung M1) không có khung chuẩn: lỗ không được lấp như trước", async () => {
      const { ea, clock, feed } = mk({ M1: all.filter((_, i) => i < 10 || i >= 30) }, { M1: moving(all) });
      await drive(feed, clock, { tfs: ["M1"], from: 0 }, 2400, ea.calls);
      expect(ea.calls).toEqual([]);
    });
  });

  it("làm mới đuôi của TD nhờ EA tính lại vài phút gần nhất rồi mới đọc; khung thường thì không", async () => {
    const db = fakeDb({ TD: run("M1", 0, 10), M1: run("M1", 0, 10) });
    const calls: { tf: string; count: number; before: number }[] = [];
    const clock = { now: 0 };
    const backfill = async (_s: string, tf: string, count: number, before: number) => {
      calls.push({ tf, count, before });
      if (tf === "TD") db.data.TD.push(bar(600, 7)); // EA gửi phút mới
      return true;
    };
    const onChange = vi.fn();
    const feed = new LowerFeed(db.fetch, onChange, { now: () => clock.now, backfill, sleep: async () => {} });
    const need = { tfs: [TICK_TF], from: 0 };
    feed.get("X", need, 660);
    await flush();
    expect(calls).toEqual([]); // lần đầu đọc DB, chưa làm mới đuôi
    clock.now = 16_000;
    feed.get("X", need, 660);
    await flush();
    expect(calls).toEqual([{ tf: "TD", count: 3, before: 660 }]);
    expect(feed.get("X", need, 660).at(-1)).toMatchObject({ t: 600, c: 7 });
    expect(onChange).toHaveBeenCalledTimes(3); // đọc đầu TD, đọc đầu M1 (khung chuẩn tìm lỗ), làm mới đuôi TD
    // khung thường: đọc đuôi từ DB, không nhờ EA
    const feed2 = new LowerFeed(db.fetch, () => {}, { now: () => clock.now, backfill, sleep: async () => {} });
    feed2.get("X", { tfs: ["M1"], from: 0 }, 660);
    await flush();
    clock.now = 40_000;
    feed2.get("X", { tfs: ["M1"], from: 0 }, 660);
    await flush();
    expect(calls.filter((c) => c.tf === "M1")).toEqual([]);
  });

  it("delta tick realtime: push thay nến cuối và nối phút mới, onChange khi tính lại; chưa nạp DB thì bỏ qua", async () => {
    const db = fakeDb({ TD: run("M1", 0, 10) });
    const clock = { now: 0 };
    const feed = new LowerFeed(db.fetch, () => {}, { now: () => clock.now, backfill: async () => true, sleep: async () => {} });
    const need = { tfs: [TICK_TF], from: 0 };
    expect(feed.push("X", TICK_TF, [bar(540, 5)])).toBe(false); // chưa đọc DB
    feed.get("X", need, 660);
    await flush();
    expect(feed.push("X", TICK_TF, [bar(540, 5), bar(600, 6)])).toBe(true);
    expect(feed.get("X", need, 660).slice(-3).map((b) => [b.t, b.c])).toEqual([[480, 8], [540, 5], [600, 6]]);
    // phút đang chạy đổi tiếp, phút trước đã chốt
    feed.push("X", TICK_TF, [bar(600, 7), bar(660, 1)]);
    expect(feed.get("X", need, 720).slice(-3).map((b) => [b.t, b.c])).toEqual([[540, 5], [600, 7], [660, 1]]);
    expect(feed.push("X", TICK_TF, [])).toBe(false);
  });

  it("đang nhận delta tick realtime thì đuôi TD không nhờ EA tính lại; ngừng nhận 20 giây thì nhờ lại", async () => {
    const db = fakeDb({ TD: run("M1", 0, 10) });
    const calls: number[] = [];
    const clock = { now: 0 };
    const backfill = async (_s: string, _tf: string, count: number) => (calls.push(count), true);
    const feed = new LowerFeed(db.fetch, () => {}, { now: () => clock.now, backfill, sleep: async () => {} });
    const need = { tfs: [TICK_TF], from: 0 };
    feed.get("X", need, 660);
    await flush();
    feed.push("X", TICK_TF, [bar(540, 2), bar(600, 3)]); // lô chốt phút 540 + phút đang chạy 600
    clock.now = 16_000; // quá 15 giây làm mới đuôi nhưng vừa nhận push
    feed.get("X", need, 660);
    await flush();
    expect(calls).toEqual([]);
    expect(db.calls.filter((c) => c.tf === TICK_TF)).toHaveLength(1); // cũng không đọc lại DB
    clock.now = 40_000; // ngừng nhận
    feed.get("X", need, 660);
    await flush();
    expect(calls).toEqual([3]);
  });

  it("lỡ lô đẩy chốt một phút (lô sau bắt đầu muộn hơn phút cuối đang giữ): đọc lại đuôi DB từ phút đó dù live đang chạy, không nhờ EA", async () => {
    const db = fakeDb({ TD: run("M1", 0, 10) }); // phút 0..540, 540 đang chạy lúc đọc
    const calls: number[] = [];
    const feed = new LowerFeed(db.fetch, () => {}, { now: () => 0, backfill: async (_s, _tf, count) => (calls.push(count), true), sleep: async () => {} });
    const need = { tfs: [TICK_TF], from: 0 };
    feed.get("X", need, 720);
    await flush();
    db.data.TD[9] = bar(540, 10); // phút 540 chốt +10 trong DB, lô đẩy dòng chốt đó bị lỡ (WS nối lại)
    db.data.TD.push(bar(600, 1), bar(660, 2));
    feed.push("X", TICK_TF, [bar(660, 2)]);
    feed.get("X", need, 720);
    await flush();
    expect(feed.get("X", need, 720).slice(-3).map((b) => [b.t, b.c])).toEqual([[540, 10], [600, 1], [660, 2]]);
    expect(db.calls.filter((c) => c.tf === TICK_TF).at(-1)?.from).toBe(540);
    expect(calls).toEqual([]);
  });

  it("phút được đẩy tới trong lúc đang đọc đuôi DB không bị bản DB (cũ hơn) ghi đè", async () => {
    const db = fakeDb({ TD: run("M1", 0, 10) });
    let release: (() => void) | null = null;
    const slow: typeof db.fetch = (symbol, tf, from, to, limit) => {
      const got = db.fetch(symbol, tf, from, to, limit);
      return release === null && from > 0 ? new Promise((r) => (release = () => r(got))) : got;
    };
    const feed = new LowerFeed(slow, () => {}, { now: () => 0, sleep: async () => {} });
    const need = { tfs: [TICK_TF], from: 0 };
    feed.get("X", need, 720);
    await flush();
    feed.push("X", TICK_TF, [bar(660, 1)]); // lỡ phút 540: đọc lại đuôi
    feed.get("X", need, 720); // bắt đầu đọc, DB lúc này: 540 dở (giá trị cũ), chưa có 600 / 660
    await flush();
    feed.push("X", TICK_TF, [bar(660, 4), bar(720, 1)]); // trong lúc đọc: 660 chốt +4, 720 đang chạy
    release!();
    await flush();
    expect(feed.get("X", need, 780).slice(-2).map((b) => [b.t, b.c])).toEqual([[660, 4], [720, 1]]);
  });
});
