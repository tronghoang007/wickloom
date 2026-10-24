import type { Bar } from "@/lib/api";
import { computeProfile } from "@/volumeProfile/compute";
import { describe, expect, it } from "vitest";
import type { ProfileStyle } from "../schema";
import { layoutProfile } from "./profile";

const line = { show: true, color: "#fff", width: 1, style: "solid" as const };
const style = (over: Partial<ProfileStyle> = {}): ProfileStyle => ({
  volume: "updown", width: 50, place: "left", values: false, extend: false, pinned: false,
  up: "#up", down: "#dn", vaUp: "#vaup", vaDown: "#vadn", poc: line, vah: line, val: line, ...over,
});

const bar = (o: number, h: number, l: number, c: number, v: number): Bar => ({ t: 0, o, h, l, c, v });
// 10 giá (100..110, tick 1, 10 row): nến tăng ở 100..102 (vol 30), nến giảm ở 104..106 (vol 60, POC ở đây), nến tăng ở 108..110 (vol 10)
const vp = computeProfile([bar(100, 102, 100, 102, 30), bar(106, 106, 104, 104, 60), bar(108, 110, 108, 110, 10)], 1, 10, 70)!;

describe("layoutProfile", () => {
  it("histogram rộng width% của khoảng, bám mép trái khi Placement Left", () => {
    const l = layoutProfile(vp, style(), 100, 300); // khoảng 200, width 50% = 100
    expect(l.dir).toBe(1);
    expect(l.base).toBe(100);
    const widest = Math.max(...l.rows.map((r) => r.len));
    expect(widest).toBeCloseTo(100, 6);
    for (const r of l.rows) for (const s of r.segs) expect(s.x0).toBeGreaterThanOrEqual(100);
  });

  it("Placement Right: bám mép phải, đoạn đi ngược về trái", () => {
    const l = layoutProfile(vp, style({ place: "right" }), 100, 300);
    expect(l.dir).toBe(-1);
    expect(l.base).toBe(300);
    for (const r of l.rows) for (const s of r.segs) expect(Math.max(s.x0, s.x1)).toBeLessThanOrEqual(300);
  });

  it("Up/Down: hai đoạn nối tiếp, tổng dài theo tổng volume của row; row cao nhất = POC", () => {
    const l = layoutProfile(vp, style(), 0, 200);
    const poc = vp.poc;
    expect(l.rows[poc].len).toBeCloseTo(Math.max(...l.rows.map((r) => r.len)), 6);
    const r = l.rows.find((x) => x.segs.length === 2);
    if (r) expect(r.segs[0].x1).toBeCloseTo(r.segs[1].x0, 9);
    expect(l.rows.some((x) => x.segs.length === 0 && x.len === 0)).toBe(true); // row không có volume
  });

  it("row trong Value Area dùng màu VA và đậm hơn", () => {
    const l = layoutProfile(vp, style(), 0, 200);
    const inVa = l.rows.find((r) => r.i >= vp.vl && r.i <= vp.vh && r.segs.length > 0)!;
    expect(inVa.segs.every((s) => s.color === "#vaup" || s.color === "#vadn")).toBe(true);
    expect(inVa.segs[0].alpha).toBeGreaterThan(0.5);
    const out = l.rows.find((r) => (r.i < vp.vl || r.i > vp.vh) && r.segs.length > 0);
    if (out) {
      expect(out.segs.every((s) => s.color === "#up" || s.color === "#dn")).toBe(true);
      expect(out.segs[0].alpha).toBeLessThan(0.5);
    }
  });

  it("Total: một đoạn mỗi row; Delta: dài theo |up − down|, màu theo dấu", () => {
    const total = layoutProfile(vp, style({ volume: "total" }), 0, 200);
    expect(total.rows.filter((r) => r.len > 0).every((r) => r.segs.length === 1)).toBe(true);
    const delta = layoutProfile(vp, style({ volume: "delta" }), 0, 200);
    const delt = vp.up.map((u, i) => u - vp.dn[i]);
    const maxD = Math.max(...delt.map(Math.abs));
    delta.rows.forEach((r) => {
      expect(r.len).toBeCloseTo((Math.abs(delt[r.i]) / maxD) * 100, 6);
      if (delt[r.i] > 0) expect(r.segs[0].color).toMatch(/up/);
      if (delt[r.i] < 0) expect(r.segs[0].color).toMatch(/dn|down/);
    });
    expect(delta.rows[vp.poc].shown).toBe(delt[vp.poc]);
  });

  it("POC / VAH / VAL: VAL ≤ POC ≤ VAH và nằm trong khoảng giá của profile", () => {
    const { lines } = layoutProfile(vp, style(), 0, 200);
    const p = Object.fromEntries(lines.map((l) => [l.kind, l.price]));
    expect(p.val).toBeLessThanOrEqual(p.poc);
    expect(p.poc).toBeLessThanOrEqual(p.vah);
    expect(p.val).toBeGreaterThanOrEqual(vp.lo);
    expect(p.vah).toBeLessThanOrEqual(vp.hi);
    expect(p.poc).toBeCloseTo(vp.lo + vp.size * (vp.poc + 0.5), 6);
  });

  it("khoảng quá hẹp: histogram tối thiểu 20 đơn vị", () => {
    const l = layoutProfile(vp, style({ width: 10 }), 0, 50);
    expect(Math.max(...l.rows.map((r) => r.len))).toBeCloseTo(20, 6);
  });
});

describe("layoutProfile: Delta + Total", () => {
  const st = (over: Partial<ProfileStyle> = {}) => style({ volume: "deltatotal", values: true, ...over });

  it("chia đôi bề rộng quanh một trục: delta sang trái, total sang phải, mỗi bên chuẩn hoá theo row lớn nhất của nó", () => {
    const l = layoutProfile(vp, st(), 100, 300); // khoảng 200, width 50% = 100 -> trục ở 100 + 50, mỗi nửa 50
    expect(l.axis).toBe(150);
    const left = (r: (typeof l.rows)[number]) => r.segs.find((s) => s.x1 < s.x0);
    const right = (r: (typeof l.rows)[number]) => r.segs.find((s) => s.x1 > s.x0);
    expect(Math.max(...l.rows.map((r) => (left(r) ? Math.abs(left(r)!.x1 - 150) : 0)))).toBeCloseTo(50, 6);
    expect(Math.max(...l.rows.map((r) => (right(r) ? right(r)!.x1 - 150 : 0)))).toBeCloseTo(50, 6);
    for (const r of l.rows) for (const s of r.segs) expect(s.x0).toBe(150); // mọi đoạn đi ra từ trục
    const poc = l.rows[vp.poc];
    expect(right(poc)!.x1 - 150).toBeCloseTo(50, 6); // row total lớn nhất = POC dài hết nửa phải
  });

  it("màu delta theo dấu (mua hơn bán: Up, ngược lại: Down), total dùng màu Up", () => {
    const l = layoutProfile(vp, st(), 0, 200);
    const delta = vp.up.map((u, i) => u - vp.dn[i]);
    l.rows.forEach((r, i) => {
      const d = r.segs.find((s) => s.x1 < s.x0);
      if (!d) return;
      const inVa = i >= vp.vl && i <= vp.vh;
      expect(d.color).toBe(delta[i] > 0 ? (inVa ? "#vaup" : "#up") : inVa ? "#vadn" : "#dn");
    });
    for (const r of l.rows) for (const s of r.segs.filter((x) => x.x1 > x.x0)) expect(["#up", "#vaup"]).toContain(s.color);
  });

  it("nhãn: delta (căn phải, bên trái đầu thanh) và total (căn trái, bên phải đầu thanh); row 0 volume không có nhãn", () => {
    const l = layoutProfile(vp, st(), 0, 200);
    const poc = l.rows[vp.poc];
    expect(poc.labels).toEqual([
      { x: expect.any(Number), text: String(Math.round(vp.up[vp.poc] - vp.dn[vp.poc])), align: "right" },
      { x: l.axis! + poc.len + 3, text: String(Math.round(vp.total[vp.poc])), align: "left" },
    ]);
    expect(l.rows.find((r) => vp.total[r.i] === 0)!.labels).toEqual([]);
  });

  it("Placement Right: dải histogram nằm sát mép phải nhưng delta vẫn bên trái trục, total bên phải", () => {
    const l = layoutProfile(vp, st({ place: "right" }), 100, 300);
    expect(l.axis).toBe(300 - 50); // dải [200, 300], trục giữa dải
    for (const r of l.rows) for (const s of r.segs) expect(Math.min(s.x0, s.x1)).toBeGreaterThanOrEqual(200);
  });

  it("kiểu khác không có trục", () => {
    expect(layoutProfile(vp, style({ volume: "delta" }), 0, 200).axis).toBeUndefined();
  });
});

