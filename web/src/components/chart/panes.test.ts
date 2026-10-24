import { describe, expect, it } from "vitest";
import { paneAt, squeezedHeights, squeezedPanes } from "./panes";

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
