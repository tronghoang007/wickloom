import type { Bar } from "@/lib/api";
import { describe, expect, it, vi } from "vitest";
import { BarHistory, CalendarFeed } from "./data";

const bar = (t: number): Bar => ({ t, o: 1, h: 2, l: 0, c: 1, v: 1 });
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => bar(from + i * 60));
const flush = () => new Promise((r) => setTimeout(r, 0));

/** DB giả: có các nến t = 0, 60, ..., (total−1)·60; trả `limit` nến cuối cùng trước `to` (như backend). */
const db = (total: number) =>
  vi.fn(async (_s: string, _tf: string, to: number | undefined, limit: number) => {
    const all = range(0, total).filter((b) => to === undefined || b.t < to);
    return all.slice(Math.max(0, all.length - limit));
  });

describe("BarHistory", () => {
  it("nạp thêm nến cũ cho đủ target, nến chart không bị đổi", async () => {
    const fetch = db(1000);
    const onChange = vi.fn();
    const h = new BarHistory(fetch, onChange);
    const chart = range(900 * 60, 100); // nến 900..999
    expect(h.merge("X|M1", chart)).toEqual({ all: chart, cut: 0 });
    h.ensure("X", "M1", chart, 400);
    expect(fetch).toHaveBeenCalledWith("X", "M1", 900 * 60, 300);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    const { all, cut } = h.merge("X|M1", chart);
    expect(cut).toBe(300);
    expect(all).toHaveLength(400);
    expect(all[0].t).toBe(600 * 60);
    expect(all.slice(cut)).toEqual(chart);
    expect(all.every((b, i) => i === 0 || b.t > all[i - 1].t)).toBe(true);
  });

  it("đủ rồi thì không gọi lại; chỉ một yêu cầu mỗi lúc", async () => {
    const fetch = db(1000);
    const h = new BarHistory(fetch, () => {});
    const chart = range(900 * 60, 100);
    h.merge("k", chart);
    h.ensure("X", "M1", chart, 400);
    h.ensure("X", "M1", chart, 400); // đang nạp
    expect(fetch).toHaveBeenCalledTimes(1);
    await flush();
    h.ensure("X", "M1", chart, 400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("DB hết nến: đánh dấu exhausted, không hỏi lại", async () => {
    const fetch = db(150);
    const h = new BarHistory(fetch, () => {});
    const chart = range(100 * 60, 50);
    h.merge("k", chart);
    h.ensure("X", "M1", chart, 1000);
    await flush();
    expect(h.merge("k", chart).cut).toBe(100);
    h.ensure("X", "M1", chart, 1000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("chart tự nạp thêm nến cũ (chồng với lịch sử): phần chồng bị bỏ, không trùng nến", async () => {
    const h = new BarHistory(db(1000), () => {});
    const chart = range(900 * 60, 100);
    h.merge("k", chart);
    h.ensure("X", "M1", chart, 400);
    await flush();
    const chart2 = range(800 * 60, 200); // chart giờ bắt đầu từ nến 800
    const { all, cut } = h.merge("k", chart2);
    expect(cut).toBe(200); // lịch sử 600..799
    expect(all).toHaveLength(400);
    expect(new Set(all.map((b) => b.t)).size).toBe(400);
  });

  it("đổi symbol/khung: bỏ lịch sử cũ và kết quả nạp dở không lọt sang khoá mới", async () => {
    let release: (b: Bar[]) => void = () => {};
    const fetch = vi.fn(() => new Promise<Bar[]>((r) => (release = r)));
    const onChange = vi.fn();
    const h = new BarHistory(fetch, onChange);
    const chart = range(900 * 60, 100);
    h.merge("A|M1", chart);
    h.ensure("A", "M1", chart, 400);
    h.merge("B|M1", chart); // đổi khung trong lúc chờ
    release(range(600 * 60, 300));
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(h.merge("B|M1", chart).cut).toBe(0);
  });

  it("lỗi mạng: thử lại sau một khoảng, không lặp liên tục", async () => {
    let now = 1000;
    const fetch = vi.fn().mockRejectedValueOnce(new Error("net")).mockResolvedValue(range(0, 5));
    const h = new BarHistory(fetch, () => {}, () => now);
    const chart = range(900 * 60, 100);
    h.merge("k", chart);
    h.ensure("X", "M1", chart, 105);
    await flush();
    h.ensure("X", "M1", chart, 105);
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 11_000;
    h.ensure("X", "M1", chart, 105);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("chưa có nến chart thì không nạp", () => {
    const fetch = db(10);
    const h = new BarHistory(fetch, () => {});
    h.merge("k", []);
    h.ensure("X", "M1", [], 100);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("CalendarFeed", () => {
  it("chưa nạp xong -> null; xong thì báo thay đổi và trả offset + mốc ngày", async () => {
    const onChange = vi.fn();
    const f = new CalendarFeed({ offset: async () => 7200, dayOpens: async () => [10, 20] }, onChange);
    expect(f.get("XAUUSDm")).toBeNull();
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(f.get("XAUUSDm")).toEqual({ offset: 7200, dayOpens: [10, 20] });
  });

  it("đổi symbol nạp lại; kết quả của symbol cũ bị bỏ", async () => {
    const dayOpens = vi.fn(async (s: string) => (s === "A" ? [1] : [2]));
    const f = new CalendarFeed({ offset: async () => 0, dayOpens }, () => {});
    f.get("A");
    expect(f.get("B")).toBeNull();
    await flush();
    expect(f.get("B")).toEqual({ offset: 0, dayOpens: [2] });
  });

  it("lỗi mạng: dùng offset 0, không có dayOpens (vẫn vẽ được theo offset)", async () => {
    const f = new CalendarFeed({ offset: async () => { throw new Error("x"); }, dayOpens: async () => [] }, () => {});
    f.get("A");
    await flush();
    expect(f.get("A")).toEqual({ offset: 0 });
  });

  it("lỗi mạng / chưa có mốc D1: nạp lại sau 30 giây thay vì giữ lịch tạm tới khi đổi symbol", async () => {
    let now = 0;
    let up = false;
    const dayOpens = vi.fn(async () => {
      if (!up) throw new Error("backend chưa lên");
      return [100, 200];
    });
    const onChange = vi.fn();
    const f = new CalendarFeed({ offset: async () => (up ? 7200 : 0), dayOpens }, onChange, () => now);
    f.get("A");
    await flush();
    expect(f.get("A")).toEqual({ offset: 0 });
    expect(dayOpens).toHaveBeenCalledTimes(1);
    up = true;
    now = 29_000;
    f.get("A");
    expect(dayOpens).toHaveBeenCalledTimes(1); // chưa tới hạn
    now = 30_000;
    f.get("A");
    await flush();
    expect(f.get("A")).toEqual({ offset: 7200, dayOpens: [100, 200] });
    now = 1e9;
    f.get("A");
    expect(dayOpens).toHaveBeenCalledTimes(2); // đủ rồi: không nạp lại nữa
  });

  it("đã có lịch mà lần nạp lại lỗi: giữ bản đã có", async () => {
    let now = 0;
    let fail = false;
    const f = new CalendarFeed({ offset: async () => 7200, dayOpens: async () => (fail ? Promise.reject(new Error("x")) : []) }, () => {}, () => now);
    f.get("A");
    await flush();
    expect(f.get("A")).toEqual({ offset: 7200 }); // chưa có D1: hẹn nạp lại
    fail = true;
    now = 30_000;
    f.get("A");
    await flush();
    expect(f.get("A")).toEqual({ offset: 7200 });
  });
});
