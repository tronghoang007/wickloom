import { beforeEach, describe, expect, it } from "vitest";
import { useRailStore } from "./rail";

const rail = () => useRailStore.getState();

beforeEach(() => useRailStore.setState({ open: null, before: null }));

describe("thanh bên phải khi mở / đóng bảng đặt lệnh", () => {
  it("đang xem Watchlist → mở bảng đặt lệnh → đặt xong thì quay về Watchlist (thanh không đóng)", () => {
    rail().setOpen("watchlist");
    rail().openOrder();
    expect(rail().open).toBe("order");
    rail().closeOrder();
    expect(rail().open).toBe("watchlist");
    expect(rail().before).toBeNull();
  });

  it("thanh đang đóng → mở bảng đặt lệnh → xong thì đóng lại như cũ", () => {
    rail().openOrder();
    expect(rail().open).toBe("order");
    rail().closeOrder();
    expect(rail().open).toBeNull();
  });

  it("mở bản nháp mới khi bảng đã mở: vẫn nhớ panel TRƯỚC bảng, không nhớ chính bảng", () => {
    rail().setOpen("calendar");
    rail().openOrder();
    rail().openOrder();
    rail().closeOrder();
    expect(rail().open).toBe("calendar");
  });

  it("người dùng tự chuyển sang panel khác lúc đang soạn: đóng bản nháp không đổi panel đó", () => {
    rail().setOpen("watchlist");
    rail().openOrder();
    rail().setOpen("calendar");
    rail().closeOrder();
    expect(rail().open).toBe("calendar");
    expect(rail().before).toBeNull();
  });
});
