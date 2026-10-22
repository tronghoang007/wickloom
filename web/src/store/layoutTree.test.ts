import { describe, expect, it } from "vitest";
import {
  FULL, MAX_PANES, TEMPLATES, buildTemplate, dragSizes, gutters, isLeaf, nextPaneId, paneIds, paneRects, retarget, templateById, withSizes,
  type Node,
} from "./layoutTree";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const area = (r: { w: number; h: number }) => r.w * r.h;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe("template", () => {
  it("id không trùng, số ô trong 1..MAX_PANES, cây có đúng ngần ô và mỗi id đúng một lần", () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) {
      expect(t.count).toBeGreaterThanOrEqual(1);
      expect(t.count).toBeLessThanOrEqual(MAX_PANES);
      const tree = buildTemplate(t.id, ids(t.count));
      expect(paneIds(tree)).toEqual(ids(t.count)); // thứ tự trái→phải, trên→dưới giữ đúng thứ tự pane
    }
  });

  it("các ô lát kín khung: tổng diện tích = 1, nằm trong khung, không chồng nhau", () => {
    for (const t of TEMPLATES) {
      const rects = Object.values(paneRects(buildTemplate(t.id, ids(t.count))));
      expect(near(rects.reduce((s, r) => s + area(r), 0), 1)).toBe(true);
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(-1e-9);
        expect(r.y).toBeGreaterThanOrEqual(-1e-9);
        expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
        expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
      }
      rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => {
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ox > 1e-9 && oy > 1e-9).toBe(false);
      }));
    }
  });

  it("hình dạng cụ thể: 2×2, 1 trái + 2 phải", () => {
    const g = paneRects(buildTemplate("4-grid", ids(4)));
    expect(g.p1).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
    expect(g.p4).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    const l = paneRects(buildTemplate("3-l1r2", ids(3)));
    expect(l.p1).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(l.p2).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
    expect(l.p3).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  it("sai số ô hoặc mẫu lạ thì báo lỗi", () => {
    expect(() => buildTemplate("4-grid", ids(3))).toThrow();
    expect(() => buildTemplate("nope", ids(1))).toThrow();
    expect(templateById("nope")).toBeUndefined();
  });
});

describe("gutters", () => {
  it("mỗi nhóm n con có n-1 đường chia; 2×2 có 3 (1 ngang + 2 dọc)", () => {
    const g = gutters(buildTemplate("4-grid", ids(4)));
    expect(g).toHaveLength(3);
    expect(g.filter((x) => x.dir === "col")).toHaveLength(1);
    expect(g.filter((x) => x.dir === "row")).toHaveLength(2);
    const horiz = g.find((x) => x.dir === "col")!; // col = chia hàng → đường nằm ngang giữa khung
    expect(horiz.line).toEqual({ x: 0, y: 0.5, w: 1, h: 0 });
    expect(horiz.path).toEqual([]);
  });

  it("kéo độc lập: 1 trái + 2 phải — đường dọc giữa 2 ô phải không chạm ô trái", () => {
    const g = gutters(buildTemplate("3-l1r2", ids(3)));
    const inner = g.find((x) => x.path.length === 1)!;
    expect(inner.dir).toBe("col");
    expect(inner.parent).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(inner.line).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0 }); // chỉ nằm trong nửa phải
  });

  it("vị trí đường chia bám theo sizes", () => {
    const t = buildTemplate("2-cols", ids(2));
    const resized = withSizes(t, [], [0.3, 0.7]);
    expect(gutters(resized)[0].line.x).toBeCloseTo(0.3);
    expect(paneRects(resized).p2).toEqual({ x: 0.3, y: 0, w: 0.7, h: 1 });
  });
});

describe("dragSizes", () => {
  it("dời đường chia, tổng không đổi", () => {
    const r = dragSizes([0.5, 0.5], 0, 0.1, 0.1);
    expect(r[0]).toBeCloseTo(0.6);
    expect(r[1]).toBeCloseTo(0.4);
  });

  it("mỗi ô giữ tối thiểu `min`, kể cả kéo quá tay", () => {
    const hi = dragSizes([0.5, 0.5], 0, 5, 0.1);
    expect([hi[0], hi[1]]).toEqual([expect.closeTo(0.9, 9), expect.closeTo(0.1, 9)]);
    const lo = dragSizes([0.5, 0.5], 0, -5, 0.1);
    expect([lo[0], lo[1]]).toEqual([expect.closeTo(0.1, 9), expect.closeTo(0.9, 9)]);
  });

  it("chỉ đụng 2 ô kề nhau, các ô khác giữ nguyên", () => {
    const r = dragSizes([0.2, 0.3, 0.5], 1, 0.1, 0.05);
    expect(r[0]).toBe(0.2);
    expect(r[1]).toBeCloseTo(0.4);
    expect(r[2]).toBeCloseTo(0.4);
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("nhóm quá hẹp (min lớn hơn nửa tổng) thì chia đều, không âm", () => {
    const r = dragSizes([0.05, 0.05], 0, 1, 0.5);
    expect(r[0]).toBeCloseTo(0.05);
    expect(r[1]).toBeCloseTo(0.05);
  });
});

describe("withSizes", () => {
  it("bất biến và chỉ đổi đúng nhóm", () => {
    const t = buildTemplate("3-l1r2", ids(3)) as Extract<Node, { dir: string }>;
    const t2 = withSizes(t, [1], [0.25, 0.75]) as Extract<Node, { dir: string }>;
    expect(t2).not.toBe(t);
    expect(t.children[1]).toMatchObject({ sizes: [0.5, 0.5] }); // bản gốc không đổi
    expect(t2.children[1]).toMatchObject({ sizes: [0.25, 0.75] });
    expect(t2.children[0]).toBe(t.children[0]);
    expect(t2.sizes).toBe(t.sizes);
  });

  it("path vào lá / ngoài cây thì trả lại nguyên", () => {
    const t = buildTemplate("1", ["p1"]);
    expect(isLeaf(t)).toBe(true);
    expect(withSizes(t, [], [1])).toBe(t);
  });
});

describe("retarget (đổi số ô)", () => {
  it("tăng: giữ pane cũ theo thứ tự, thêm pane mới với id chưa dùng", () => {
    const r = retarget(["p1"], "4-grid");
    expect(r.ids).toEqual(["p1", "p2", "p3", "p4"]);
    expect(r.added).toEqual(["p2", "p3", "p4"]);
    expect(r.removed).toEqual([]);
    expect(paneIds(r.tree)).toEqual(r.ids);
  });

  it("giảm: bỏ các ô cuối", () => {
    const r = retarget(["p1", "p2", "p3", "p4"], "2-cols");
    expect(r.ids).toEqual(["p1", "p2"]);
    expect(r.removed).toEqual(["p3", "p4"]);
    expect(r.added).toEqual([]);
  });

  it("cùng số ô: giữ nguyên pane, chỉ đổi cây", () => {
    const r = retarget(["p1", "p2", "p3"], "3-t1b2");
    expect(r.ids).toEqual(["p1", "p2", "p3"]);
    expect(r.added).toEqual([]);
    expect(paneRects(r.tree).p1).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
  });

  it("id mới không trùng id cũ kể cả id vừa bị bỏ (pane đó có thể còn đang unmount)", () => {
    const r = retarget(["p1", "p2", "p3"], "1");
    expect(r.removed).toEqual(["p2", "p3"]);
    const r2 = retarget(["p1", "p4"], "3-cols");
    expect(r2.ids).toEqual(["p1", "p4", "p2"]);
    expect(nextPaneId(["p1", "p2", "p5"])).toBe("p3");
  });

  it("mẫu 1 ô phủ kín khung", () => {
    expect(paneRects(buildTemplate("1", ["p1"]))).toEqual({ p1: FULL });
  });
});
