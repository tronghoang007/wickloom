import type { PendingOrder, Position } from "@/lib/mt5Api";
import { MODE_LABEL } from "@/lib/mt5Format";
import { chartGlobal } from "@/store/chart";
import { askConfirm } from "@/store/confirm";
import { oneClickOn } from "@/store/settings";
import { cancelAllOrders, cancelOrder, closeAllTrades, closeTrade, moveStop } from "./actions";
import { fmtLot, fmtPnl, fmtPx, orderLabel, positionPnl, sideLabel, type LineSpec } from "./format";
import { submitDraft } from "./submit";
import { useTicketStore } from "./ticket";
import { tradeAccount, useTradeStore } from "./store";

// Nút trên thẻ lệnh của chart (kiểu TradingView): đặt lệnh của bản nháp, và dấu × của từng loại thẻ. Đọc store lúc gọi nên gọi được từ bất kỳ đâu.

/** Nút "Buy" / "Sell" ở đầu thẻ bản nháp: gửi bản nháp. Lỗi thì toast nói lý do, thành công thì đóng bản nháp. */
export function placeFromTag(): void {
  void submitDraft();
}

/** Đóng vị thế: mở hộp thoại xác nhận (trừ khi đã tắt trong Settings > Trading): tóm tắt account, lệnh, giá vào / hiện tại, lãi/lỗi (và phần lot sẽ đóng nếu đóng một phần), rồi mới gửi. `volume` = 0 đóng hết. */
export function askClosePosition(p: Position, volume = 0): void {
  const partial = volume > 0 && volume < p.volume - 1e-9;
  // Settings > Trading > One-click trading bật: đóng ngay, không hỏi
  if (oneClickOn()) {
    void closeTrade(p.ticket, p.symbol, partial ? volume : 0);
    return;
  }
  const sym = chartGlobal.getState().symbols.find((s) => s.name === p.symbol);
  const account = tradeAccount();
  const ccy = account?.currency ?? "";
  const pnl = positionPnl(p);
  const mode = account && MODE_LABEL[account.mode] ? ` · ${MODE_LABEL[account.mode]}` : "";
  askConfirm({
    title: partial ? "Đóng một phần vị thế" : "Đóng vị thế",
    rows: [
      ...(account ? [{ label: "Account", value: `${account.name || account.broker || account.server}${mode}` }] : []),
      { label: "Lệnh", value: `${sideLabel(p.type).toUpperCase()} ${fmtLot(p.volume)} ${p.symbol} #${p.ticket}`, tone: p.type === "buy" ? ("buy" as const) : ("sell" as const) },
      ...(partial ? [{ label: "Đóng", value: `${fmtLot(volume)} / ${fmtLot(p.volume)} lot` }] : []),
      { label: "Giá vào", value: fmtPx(p.price_open, sym?.digits) },
      { label: "Giá hiện tại", value: fmtPx(p.price_current, sym?.digits) },
      { label: "Lãi / Lỗ", value: `${fmtPnl(pnl)}${ccy ? ` ${ccy}` : ""}`, tone: pnl > 0 ? ("pos" as const) : pnl < 0 ? ("neg" as const) : undefined },
    ],
    confirmLabel: partial ? "Đóng một phần" : "Đóng vị thế",
    danger: true,
    onConfirm: () => closeTrade(p.ticket, p.symbol, partial ? volume : 0),
  });
}

const digitsOf = (symbol: string) => chartGlobal.getState().symbols.find((s) => s.name === symbol)?.digits;

/** Dòng "Account" của hộp thoại xác nhận (tên + nhãn DEMO / REAL). */
export function accountRows(): { label: string; value: string }[] {
  const account = tradeAccount();
  if (!account) return [];
  const mode = MODE_LABEL[account.mode] ? ` · ${MODE_LABEL[account.mode]}` : "";
  return [{ label: "Account", value: `${account.name || account.broker || account.server}${mode}` }];
}

/** Huỷ lệnh chờ: hộp thoại "Giữ lệnh / Huỷ lệnh" như TradingView (One-click trading bật thì huỷ ngay). */
export function askCancelOrder(o: PendingOrder): void {
  if (oneClickOn()) {
    void cancelOrder(o.ticket, o.symbol);
    return;
  }
  askConfirm({
    title: "Huỷ lệnh chờ",
    rows: [
      ...accountRows(),
      { label: "Lệnh", value: `${orderLabel(o.type).toUpperCase()} ${fmtLot(o.volume)} ${o.symbol} #${o.ticket}`, tone: o.type.startsWith("buy") ? ("buy" as const) : ("sell" as const) },
      { label: "Giá vào", value: fmtPx(o.price_open, digitsOf(o.symbol)) },
    ],
    confirmLabel: "Huỷ lệnh",
    cancelLabel: "Giữ lệnh",
    danger: true,
    onConfirm: () => cancelOrder(o.ticket, o.symbol),
  });
}

/** "Close all" ở bảng Positions: hộp thoại xác nhận (số vị thế + tổng lãi/lỗ), One-click trading bật thì đóng ngay. */
export function askCloseAll(positions: Position[]): void {
  if (positions.length === 0) return;
  const run = () => closeAllTrades(positions.map((p) => p.ticket));
  if (oneClickOn()) {
    void run();
    return;
  }
  const ccy = tradeAccount()?.currency ?? "";
  const pnl = positions.reduce((s, p) => s + positionPnl(p), 0);
  askConfirm({
    title: "Đóng tất cả vị thế",
    rows: [
      ...accountRows(),
      { label: "Vị thế", value: String(positions.length) },
      { label: "Lãi / Lỗ", value: `${fmtPnl(pnl)}${ccy ? ` ${ccy}` : ""}`, tone: pnl > 0 ? ("pos" as const) : pnl < 0 ? ("neg" as const) : undefined },
    ],
    confirmLabel: "Đóng tất cả",
    danger: true,
    onConfirm: run,
  });
}

/** "Cancel all" ở bảng Orders: hộp thoại xác nhận, One-click trading bật thì huỷ ngay. */
export function askCancelAll(orders: PendingOrder[]): void {
  if (orders.length === 0) return;
  const run = () => cancelAllOrders(orders.map((o) => o.ticket));
  if (oneClickOn()) {
    void run();
    return;
  }
  askConfirm({
    title: "Huỷ tất cả lệnh chờ",
    rows: [...accountRows(), { label: "Lệnh chờ", value: String(orders.length) }],
    confirmLabel: "Huỷ tất cả",
    cancelLabel: "Giữ lệnh",
    danger: true,
    onConfirm: run,
  });
}

/** Bỏ SL hoặc TP của vị thế / lệnh chờ (× trên thẻ SL/TP): hộp thoại xác nhận, One-click trading bật thì bỏ ngay. Có toast "Hoàn tác" sau khi bỏ. */
export function askRemoveStop(owner: { t: "position" | "order"; ticket: number }, kind: "sl" | "tp", price: number, symbol: string, digits: number): void {
  const run = () => moveStop({ target: owner.t, ticket: owner.ticket, symbol, field: kind, from: price }, 0, digits);
  if (oneClickOn()) {
    void run();
    return;
  }
  const data = useTradeStore.getState().data;
  const pos = owner.t === "position" ? data?.positions.find((p) => p.ticket === owner.ticket) : undefined;
  const ord = owner.t === "order" ? data?.orders.find((o) => o.ticket === owner.ticket) : undefined;
  const what = pos ? `${sideLabel(pos.type).toUpperCase()} ${fmtLot(pos.volume)} ${symbol} #${pos.ticket}` : ord ? `${orderLabel(ord.type).toUpperCase()} ${fmtLot(ord.volume)} ${symbol} #${ord.ticket}` : `${symbol} #${owner.ticket}`;
  const name = kind === "tp" ? "Take profit" : "Stop loss";
  askConfirm({
    title: `Bỏ ${name}`,
    rows: [...accountRows(), { label: "Lệnh", value: what }, { label: name, value: fmtPx(price, digits) }],
    confirmLabel: `Bỏ ${kind.toUpperCase()}`,
    cancelLabel: "Giữ lại",
    onConfirm: run,
  });
}

/** Dấu × trên thẻ: bản nháp → bỏ SL/TP hoặc đóng cả bản nháp; lệnh chờ → hộp thoại huỷ lệnh; SL/TP đã đặt → hộp thoại bỏ mức đó; vị thế → hộp thoại đóng vị thế (không làm ngay khi lỡ tay,
 *  trừ khi One-click trading đang bật). */
export function closeFromTag(line: LineSpec, symbol: string, digits: number): void {
  const tag = line.tag;
  if (!tag) return;
  const { owner } = tag;
  if (owner.t === "draft") {
    if (tag.kind === "entry") useTicketStore.getState().close();
    else useTicketStore.getState().patch({ [tag.kind]: "" });
    return;
  }
  if (tag.kind !== "entry") return askRemoveStop(owner, tag.kind, line.price, symbol, digits);
  const data = useTradeStore.getState().data;
  if (owner.t === "order") {
    const ord = data?.orders.find((x) => x.ticket === owner.ticket);
    if (ord) askCancelOrder(ord);
    return;
  }
  const pos = data?.positions.find((x) => x.ticket === owner.ticket);
  if (pos) askClosePosition(pos);
}
