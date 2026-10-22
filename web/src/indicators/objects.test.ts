import { describe, expect, it } from "vitest";
import { MAX_OBJECTS, ObjectBuilder, emptyObjects, indexAtTime, sanitizeObjects, trimObjects } from "./objects";

describe("ObjectBuilder", () => {
  it("trả lại chính object để sửa tiếp (như set_x2 của Pine)", () => {
    const b = new ObjectBuilder();
    const l = b.line({ x1: 1, y1: 10, x2: 2, y2: 10, color: "#fff" });
    l.x2 = 9;
    expect(b.set.lines[0].x2).toBe(9);
  });

  it("quá 500 thì xoá object cũ nhất, mỗi loại tính riêng", () => {
    const b = new ObjectBuilder();
    for (let i = 0; i < MAX_OBJECTS + 3; i++) b.label({ x: i, y: 1, text: String(i), color: "#fff" });
    b.box({ x1: 0, y1: 1, x2: 2, y2: 0 });
    expect(b.set.labels).toHaveLength(MAX_OBJECTS);
    expect(b.set.labels[0].text).toBe("3"); // 0,1,2 đã bị xoá
    expect(b.set.labels.at(-1)?.text).toBe(String(MAX_OBJECTS + 2));
    expect(b.set.boxes).toHaveLength(1);
  });

  it("max tuỳ chỉnh (test / indicator muốn ít hơn)", () => {
    const b = new ObjectBuilder(2);
    for (let i = 0; i < 4; i++) b.line({ x1: i, y1: 0, x2: i, y2: 1, color: "#000" });
    expect(b.set.lines.map((l) => l.x1)).toEqual([2, 3]);
  });
});

describe("sanitizeObjects", () => {
  it("bỏ object có toạ độ na / vô cực", () => {
    const s = sanitizeObjects({
      lines: [{ x1: 0, y1: 1, x2: 2, y2: 1, color: "#fff" }, { x1: NaN, y1: 1, x2: 2, y2: 1, color: "#fff" }],
      labels: [{ x: 1, y: Infinity, text: "a", color: "#fff" }, { x: 1, y: 2, text: "b", color: "#fff" }],
      boxes: [{ x1: 0, y1: 1, x2: 2, y2: NaN }],
    });
    expect(s.lines).toHaveLength(1);
    expect(s.labels.map((l) => l.text)).toEqual(["b"]);
    expect(s.boxes).toHaveLength(0);
  });

  it("giữ 500 object mới nhất nếu compute trả nhiều hơn", () => {
    const lines = Array.from({ length: 600 }, (_, i) => ({ x1: i, y1: 0, x2: i + 1, y2: 0, color: "#fff" }));
    const s = sanitizeObjects({ ...emptyObjects(), lines });
    expect(s.lines).toHaveLength(MAX_OBJECTS);
    expect(s.lines[0].x1).toBe(100);
  });
});

describe("trimObjects", () => {
  const set = {
    lines: [{ x1: 10, y1: 1, x2: 20, y2: 1, color: "#fff" }],
    labels: [{ x: 15, y: 1, text: "a", color: "#fff" }],
    boxes: [{ x1: 5, y1: 2, x2: 25, y2: 1 }],
  };
  it("cut = 0 giữ nguyên", () => {
    expect(trimObjects(set, 0)).toBe(set);
  });
  it("dịch x sang trái cut (có thể âm, không sửa object gốc)", () => {
    const t = trimObjects(set, 12);
    expect(t.lines[0]).toMatchObject({ x1: -2, x2: 8 });
    expect(t.labels[0].x).toBe(3);
    expect(t.boxes[0]).toMatchObject({ x1: -7, x2: 13 });
    expect(set.lines[0].x1).toBe(10);
  });
});

describe("indexAtTime", () => {
  const times = [100, 160, 220, 400]; // có khoảng nghỉ giữa 220 và 400
  it("đúng nến thì đúng chỉ số", () => {
    expect(indexAtTime(times, 100, 60)).toBe(0);
    expect(indexAtTime(times, 220, 60)).toBe(2);
    expect(indexAtTime(times, 400, 60)).toBe(3);
  });
  it("giữa hai nến lấy nến đứng trước", () => {
    expect(indexAtTime(times, 190, 60)).toBe(1);
    expect(indexAtTime(times, 399, 60)).toBe(2);
  });
  it("ngoài hai đầu ngoại suy theo step", () => {
    expect(indexAtTime(times, 520, 60)).toBe(5); // 2 nến sau nến cuối
    expect(indexAtTime(times, 40, 60)).toBe(-1);
  });
  it("không có nến thì na", () => {
    expect(indexAtTime([], 5, 60)).toBeNaN();
  });
});
