import { describe, expect, it } from "vitest";
import { byId } from "./catalog";
import { newInstance, migrateInstance } from "./instance";
import { MAIN_PANE, effectiveScale, movePane, otherPanes, ownPane, paneIndices, paneKeyOf, reslot, stepPane } from "./layout";

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

  it("movePane: đổi chỗ pane với pane liền kề, pane chính đứng đầu, trong pane giữ thứ tự", () => {
    const list = [inst("rsi", "r"), inst("sma", "s"), inst("macd", "m"), inst("atr", "a", { pane: ownPane("r") })];
    const uids = (l: typeof list) => l.map((i) => i.uid);
    // pane: main(s) | r(r, a) | m  ->  main(s) | m | r(r, a)
    expect(uids(movePane(list, byId, ownPane("r"), 1))).toEqual(["s", "m", "r", "a"]);
    expect(uids(movePane(list, byId, ownPane("m"), -1))).toEqual(["s", "m", "r", "a"]);
    // không đi quá hai đầu, không có pane đó thì giữ nguyên
    expect(movePane(list, byId, ownPane("r"), -1)).toBe(list);
    expect(movePane(list, byId, ownPane("m"), 1)).toBe(list);
    expect(movePane(list, byId, ownPane("zzz"), 1)).toBe(list);
  });

  it("chỉ số pane với vị trí pane chính: pane chính chen vào mainSlot, pane riêng dịch xuống", () => {
    const keys = [MAIN_PANE, "own:a", "own:b", "own:a"];
    expect(paneIndices(keys, 0)).toEqual([0, 1, 2, 1]);
    expect(paneIndices(keys, 1)).toEqual([1, 0, 2, 0]);
    expect(paneIndices(keys, 2)).toEqual([2, 0, 1, 0]);
    expect(paneIndices(keys, 9)).toEqual([2, 0, 1, 0]); // kẹp theo số pane riêng
    expect(paneIndices(keys, -3)).toEqual([0, 1, 2, 1]);
  });

  it("stepPane: pane riêng đi lên qua pane chính / xuống qua pane chính / đổi chỗ pane riêng với nhau", () => {
    const list = [inst("rsi", "r"), inst("sma", "s"), inst("macd", "m")]; // pane: main(s) | r | m
    const uids = (l: typeof list) => l.map((i) => i.uid);
    // r đi lên: vượt pane chính -> pane chính xuống 1
    expect(stepPane(list, byId, 0, ownPane("r"), -1)).toEqual({ list, mainSlot: 1 });
    // r (đang trên pane chính) đi xuống: vượt pane chính -> pane chính lên 0
    expect(stepPane(list, byId, 1, ownPane("r"), 1)).toEqual({ list, mainSlot: 0 });
    // pane chính đi xuống / đi lên
    expect(stepPane(list, byId, 0, MAIN_PANE, 1)).toEqual({ list, mainSlot: 1 });
    expect(stepPane(list, byId, 2, MAIN_PANE, -1)).toEqual({ list, mainSlot: 1 });
    // hai pane riêng liền nhau (cùng một phía của pane chính): đổi chỗ trong list, mainSlot giữ
    const swapped = stepPane(list, byId, 0, ownPane("m"), -1);
    expect(uids(swapped.list)).toEqual(["s", "m", "r"]);
    expect(swapped.mainSlot).toBe(0);
    // hết đường: trả nguyên
    expect(stepPane(list, byId, 0, MAIN_PANE, -1)).toEqual({ list, mainSlot: 0 });
    expect(stepPane(list, byId, 2, MAIN_PANE, 1)).toEqual({ list, mainSlot: 2 });
    expect(stepPane(list, byId, 0, ownPane("m"), 1)).toEqual({ list, mainSlot: 0 });
  });

  it("reslot: gỡ pane nằm trên pane chính thì pane chính tụt lên, gỡ pane dưới thì giữ nguyên", () => {
    const list = [inst("rsi", "r"), inst("sma", "s"), inst("macd", "m")]; // order r, m
    const without = (uid: string) => list.filter((i) => i.uid !== uid);
    expect(reslot(list, without("r"), byId, 2)).toBe(1); // trên pane chính: r, m -> gỡ r còn m
    expect(reslot(list, without("m"), byId, 1)).toBe(1); // m nằm dưới pane chính (slot 1 = chỉ r ở trên)
    expect(reslot(list, without("m"), byId, 2)).toBe(1);
    expect(reslot(list, list, byId, 1)).toBe(1);
    expect(reslot(list, without("r"), byId, 0)).toBe(0);
  });

  it("đi vòng lưu/đọc pane và scale; giá trị lạ bị bỏ", () => {
    const a = inst("rsi", "r", { pane: "p:1", scale: "left" });
    expect(migrateInstance(JSON.parse(JSON.stringify(a)))).toEqual(a);
    expect(migrateInstance({ uid: "u", id: "rsi", pane: "", scale: "middle" })).toEqual({ v: 1, uid: "u", id: "rsi", inputs: {} });
    expect(migrateInstance({ uid: "u", id: "rsi", pane: 5 })).toEqual({ v: 1, uid: "u", id: "rsi", inputs: {} });
  });
});
