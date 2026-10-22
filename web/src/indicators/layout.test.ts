import { describe, expect, it } from "vitest";
import { byId } from "./catalog";
import { newInstance, migrateInstance } from "./instance";
import { MAIN_PANE, effectiveScale, otherPanes, ownPane, paneIndices, paneKeyOf } from "./layout";

const inst = (id: string, uid: string, extra: object = {}) => ({ ...newInstance(id), uid, ...extra });

describe("pane / thang giá", () => {
  it("mặc định: overlay -> pane chính, còn lại pane riêng", () => {
    expect(paneKeyOf(inst("sma", "a"), byId("sma"))).toBe(MAIN_PANE);
    expect(paneKeyOf(inst("rsi", "b"), byId("rsi"))).toBe(ownPane("b"));
    expect(paneKeyOf(inst("rsi", "b", { pane: "main" }), byId("rsi"))).toBe(MAIN_PANE);
    expect(paneKeyOf(inst("sma", "a", { pane: "p:1" }), byId("sma"))).toBe("p:1");
  });

  it("chỉ số pane: main = 0, pane khác đánh số theo thứ tự xuất hiện, cùng khoá dùng chung", () => {
    expect(paneIndices([MAIN_PANE, "own:a", "own:b", MAIN_PANE, "own:a", "p:x"])).toEqual([0, 1, 2, 0, 1, 3]);
    expect(paneIndices([])).toEqual([]);
    expect(paneIndices(["own:a", "own:a"])).toEqual([1, 1]);
  });

  it("thang giá: user chọn thắng; indicator pane riêng bị đưa lên pane chính -> none", () => {
    expect(effectiveScale(inst("sma", "a"), byId("sma"), MAIN_PANE)).toBe("right");
    expect(effectiveScale(inst("rsi", "b"), byId("rsi"), ownPane("b"))).toBe("right");
    expect(effectiveScale(inst("rsi", "b", { pane: "main" }), byId("rsi"), MAIN_PANE)).toBe("none");
    expect(effectiveScale(inst("rsi", "b", { pane: "main", scale: "left" }), byId("rsi"), MAIN_PANE)).toBe("left");
    expect(effectiveScale(inst("sma", "a", { scale: "none" }), byId("sma"), MAIN_PANE)).toBe("none");
  });

  it("otherPanes: các pane khác pane hiện tại và pane chính, mỗi pane một lần", () => {
    const list = [inst("sma", "a"), inst("rsi", "b"), inst("macd", "c"), inst("atr", "d", { pane: ownPane("c") })];
    expect(otherPanes(list, list[1], byId)).toEqual([{ key: ownPane("c"), label: "MACD" }]);
    expect(otherPanes(list, list[0], byId)).toEqual([
      { key: ownPane("b"), label: "RSI" },
      { key: ownPane("c"), label: "MACD" },
    ]);
  });

  it("đi vòng lưu/đọc pane và scale; giá trị lạ bị bỏ", () => {
    const a = inst("rsi", "r", { pane: "p:1", scale: "left" });
    expect(migrateInstance(JSON.parse(JSON.stringify(a)))).toEqual(a);
    expect(migrateInstance({ uid: "u", id: "rsi", pane: "", scale: "middle" })).toEqual({ v: 1, uid: "u", id: "rsi", inputs: {} });
    expect(migrateInstance({ uid: "u", id: "rsi", pane: 5 })).toEqual({ v: 1, uid: "u", id: "rsi", inputs: {} });
  });
});
