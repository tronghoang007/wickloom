import { describe, expect, it } from "vitest";
import { VERT_DRAG_PX, paneAt, panPriceRange, squeezedHeights, squeezedPanes } from "./panes";

describe("pane chrome", () => {
  it("paneAt: pane chứa y, đường ngăn / ngoài chart là -1", () => {
    const r = [{ top: 0, height: 100 }, { top: 101, height: 50 }];
    expect([paneAt(r, 0), paneAt(r, 99.5), paneAt(r, 100.5), paneAt(r, 101), paneAt(r, 151), paneAt(r, -1)]).toEqual([0, 0, -1, 1, -1, -1]);
  });

  it("squeezedPanes: collapse chỉ ép pane đó; maximize ép mọi pane khác; chỉ số lạ bị bỏ", () => {
    expect([...squeezedPanes(3, [2], null)]).toEqual([2]);
    expect([...squeezedPanes(3, [], 1)].sort()).toEqual([0, 2]);
    expect([...squeezedPanes(3, [5, -1], 9)]).toEqual([]);
  });

  it("squeezedHeights: pane bị ép = 30px, phần dư chia theo tỉ lệ stretch factor", () => {
    expect(squeezedHeights(600, [2, 1, 1], new Set([2]))).toEqual([380, 190, 30]);
    expect(squeezedHeights(600, [2, 1, 1], new Set([0, 2]))).toEqual([30, 540, 30]);
    expect(squeezedHeights(60, [1, 1], new Set([0, 1]))).toEqual([30, 30]);
  });
});

describe("kéo chart lên / xuống", () => {
  it("panPriceRange: chuột đi xuống thì khoảng giá nhìn thấy dịch lên (nội dung đi xuống) theo số giá mỗi px, giữ nguyên độ rộng", () => {
    // pane cao 101 px -> 100 khoảng px; khoảng giá 1000..1100 -> 1 giá / px
    expect(panPriceRange({ from: 1000, to: 1100 }, 10, 101)).toEqual({ from: 1010, to: 1110 });
    expect(panPriceRange({ from: 1000, to: 1100 }, -25, 101)).toEqual({ from: 975, to: 1075 });
    expect(panPriceRange({ from: 1000, to: 1100 }, 0, 101)).toEqual({ from: 1000, to: 1100 });
  });
  it("pane thấp bất thường không chia cho 0", () => {
    const r = panPriceRange({ from: 0, to: 10 }, 5, 1);
    expect(Number.isFinite(r.from) && Number.isFinite(r.to)).toBe(true);
  });
  it("ngưỡng kéo dọc nhỏ nhưng khác 0 (rung tay khi kéo ngang không tắt tự co giãn)", () => {
    expect(VERT_DRAG_PX).toBeGreaterThan(1);
    expect(VERT_DRAG_PX).toBeLessThanOrEqual(5);
  });
});

