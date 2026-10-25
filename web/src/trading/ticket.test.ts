import { beforeEach, describe, expect, it } from "vitest";
import { useRailStore } from "@/store/rail";
import { useTradeFocus } from "./focus";
import { useTicketStore } from "./ticket";

beforeEach(() => {
  useTicketStore.setState({ draft: null, rest: null, modifyOwner: null });
  useTradeFocus.setState({ owner: null, hover: null });
  useRailStore.setState({ open: "watchlist", before: null });
});

describe("đóng bảng đặt lệnh", () => {
  it("đóng bảng Modify của lệnh đang focus thì bỏ focus trên chart và trả thanh về panel trước", () => {
    useTicketStore.getState().select("position:7");
    expect(useTradeFocus.getState().owner).toBe("position:7");
    expect(useRailStore.getState().open).toBe("order");

    useTicketStore.getState().close();

    expect(useTradeFocus.getState().owner).toBeNull();
    expect(useTicketStore.getState().modifyOwner).toBeNull();
    expect(useRailStore.getState().open).toBe("watchlist");
  });
  it("bấm biểu tượng Order để ẩn bảng Modify cũng bỏ chọn lệnh và đóng thanh", () => {
    useTicketStore.getState().select("order:9");

    useTicketStore.getState().hide();

    expect(useTradeFocus.getState().owner).toBeNull();
    expect(useTicketStore.getState().modifyOwner).toBeNull();
    expect(useRailStore.getState().open).toBeNull();
  });
  it("bấm biểu tượng Order để ẩn bản nháp thì giữ bản nháp", () => {
    useTicketStore.getState().open({ symbol: "XAUUSDm", side: "buy", mode: "market" });

    useTicketStore.getState().hide();

    expect(useTicketStore.getState().draft).not.toBeNull();
    expect(useRailStore.getState().open).toBeNull();
  });
  it("mở bản nháp mới khi chưa chọn lệnh nào cũng focus bản nháp (lệnh đã đặt mờ đi)", () => {
    useTicketStore.getState().open({ symbol: "XAUUSDm", side: "buy", mode: "market" });
    expect(useTradeFocus.getState().owner).toBe("draft");
  });
  it("đặt xong bản nháp thì bỏ focus để các lệnh hết mờ", () => {
    useTicketStore.getState().open({ symbol: "XAUUSDm", side: "buy", mode: "market" });
    useTicketStore.getState().settle({ side: "buy", mode: "market" });
    expect(useTradeFocus.getState().owner).toBeNull();
  });
  it("đóng bản nháp cũng bỏ focus", () => {
    useTicketStore.getState().open({ symbol: "XAUUSDm", side: "buy", mode: "market" });
    useTicketStore.getState().close();
    expect(useTradeFocus.getState().owner).toBeNull();
    expect(useTicketStore.getState().draft).toBeNull();
    expect(useRailStore.getState().open).toBe("watchlist");
  });
});
