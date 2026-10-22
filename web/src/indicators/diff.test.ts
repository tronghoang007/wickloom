import { describe, expect, it } from "vitest";
import { planUpdate, type Snap } from "./diff";

const snap = (values: number[], colors?: string[]): Snap => ({ times: values.map((_, i) => 100 + i * 60), values, colors });

describe("planUpdate", () => {
  it("chưa có dữ liệu cũ -> setData cả mảng", () => {
    expect(planUpdate(null, snap([1, 2, 3]))).toEqual({ kind: "all" });
  });

  it("không đổi -> không làm gì", () => {
    expect(planUpdate(snap([1, 2, 3]), snap([1, 2, 3]))).toEqual({ kind: "none" });
  });

  it("na so sánh bằng nhau", () => {
    expect(planUpdate(snap([NaN, 2]), snap([NaN, 2]))).toEqual({ kind: "none" });
  });

  it("tick: chỉ nến cuối đổi -> update điểm cuối", () => {
    expect(planUpdate(snap([1, 2, 3]), snap([1, 2, 3.5]))).toEqual({ kind: "tail", from: 2 });
  });

  it("nến mới: nối thêm 1 điểm (nến cũ giữ nguyên)", () => {
    expect(planUpdate(snap([1, 2, 3]), snap([1, 2, 3, 4]))).toEqual({ kind: "tail", from: 3 });
  });

  it("nến mới và nến cuối cũ vừa chốt giá trị khác -> update từ nến cuối cũ", () => {
    expect(planUpdate(snap([1, 2, 3]), snap([1, 2, 3.2, 4]))).toEqual({ kind: "tail", from: 2 });
  });

  it("na -> có giá trị ở nến cuối", () => {
    expect(planUpdate(snap([1, NaN]), snap([1, 5]))).toEqual({ kind: "tail", from: 1 });
  });

  it("đổi giá trị ở giữa (đổi input, nến cũ sửa) -> setData", () => {
    expect(planUpdate(snap([1, 2, 3]), snap([1, 9, 3]))).toEqual({ kind: "all" });
  });

  it("nạp thêm lịch sử phía trước / ngắn đi / nhảy xa -> setData", () => {
    const a = snap([1, 2, 3]);
    expect(planUpdate(a, { times: [40, ...a.times], values: [0, 1, 2, 3] })).toEqual({ kind: "all" });
    expect(planUpdate(a, snap([1, 2]))).toEqual({ kind: "all" });
    expect(planUpdate(a, snap([1, 2, 3, 4, 5]))).toEqual({ kind: "all" });
  });

  it("đổi màu từng nến", () => {
    expect(planUpdate(snap([1, 2], ["a", "b"]), snap([1, 2], ["a", "c"]))).toEqual({ kind: "tail", from: 1 });
    expect(planUpdate(snap([1, 2], ["a", "b"]), snap([1, 2], ["x", "b"]))).toEqual({ kind: "all" });
  });
});
