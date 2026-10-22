import type { Bar } from "@/lib/api";
import { describe, expect, it, vi } from "vitest";
import { LOWER_TFS, LowerFeed, autoLowerTf, lowerCandidates, mergeSources, withinBudget } from "./lower";

const bar = (t: number, c = 1, v = 1): Bar => ({ t, o: c, h: c, l: c, c, v });
const run = (tf: string, from: number, count: number): Bar[] => Array.from({ length: count }, (_, i) => bar(from + i * ({ M1: 60, M5: 300 }[tf] ?? 60), i));

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
    const feed = new LowerFeed(db.fetch, onChange, () => 0);
    expect(feed.get("X", { tfs: ["M1"], from: 0 }, 600)).toEqual([]);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(feed.get("X", { tfs: ["M1"], from: 0 }, 600)).toHaveLength(10);
    expect(db.calls).toHaveLength(1);
  });

  it("phân trang lùi khi nhiều hơn một trang", async () => {
    const db = fakeDb({ M1: run("M1", 0, 10) });
    const feed = new LowerFeed(db.fetch, () => {}, () => 0, 4);
    feed.get("X", { tfs: ["M1"], from: 0 }, 600);
    await flush();
    expect(feed.get("X", { tfs: ["M1"], from: 0 }, 600).map((b) => b.t)).toEqual(run("M1", 0, 10).map((b) => b.t));
    expect(db.calls.map((c) => [c.from, c.to])).toEqual([[0, 600], [0, 360], [0, 120]]); // 4 + 4 + 2
  });

  it("cuộn trái (from nhỏ hơn) chỉ nạp phần cũ thêm", async () => {
    const db = fakeDb({ M1: run("M1", 0, 20) });
    const feed = new LowerFeed(db.fetch, () => {}, () => 0);
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
    const feed = new LowerFeed(db.fetch, () => {}, () => 0);
    for (let i = 0; i < 3; i++) {
      feed.get("X", { tfs: ["M1"], from: 0 }, 900);
      await flush();
    }
    expect(db.calls).toHaveLength(1);
  });

  it("ghép nhiều khung: M1 chỗ có, M5 cho vùng cũ", async () => {
    const db = fakeDb({ M1: run("M1", 3000, 5), M5: run("M5", 0, 20) }); // M1 từ 3000; M5 0..5700
    const feed = new LowerFeed(db.fetch, () => {}, () => 0);
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
    const feed = new LowerFeed(db.fetch, onChange, () => now);
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

  it("lỗi mạng: thử lại sau 10 giây, không ném", async () => {
    let now = 0;
    let fail = true;
    const fetch = vi.fn(async () => {
      if (fail) throw new Error("net");
      return run("M1", 0, 3);
    });
    const feed = new LowerFeed(fetch, () => {}, () => now);
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
    const feed = new LowerFeed(db.fetch, () => {}, () => 0);
    feed.get("A", { tfs: ["M1"], from: 0 }, 300);
    feed.get("B", { tfs: ["M1"], from: 0 }, 300);
    await flush();
    expect(db.calls).toHaveLength(2);
  });
});
