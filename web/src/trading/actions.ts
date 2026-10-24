import { sendCancelOrder, sendClosePosition, sendMarketOrder, sendModifyOrder, sendModifyPosition, sendPendingOrder, type PendingRequest, type TradeOutcome, type TradeResult } from "@/lib/tradeApi";
import type { PendingOrder } from "@/lib/mt5Api";
import { useAuthStore } from "@/store/auth";
import { useMt5Store } from "@/store/mt5";
import { toast } from "@/store/toast";
import { create } from "zustand";
import { fmtLot, fmtPx } from "./format";
import { isPendingType, pendingLabel, resolveOrderType, sideOfType } from "./orderType";
import { useQuoteStore } from "./quote";
import { useTradeStore } from "./store";

// Hành động giao dịch của người dùng (docs/trade-plan.md T2-T3): luôn qua requireLogin, mỗi lần chỉ một lệnh đang bay, kết quả báo bằng toast.
export const useOrderState = create<{ busy: boolean }>()(() => ({ busy: false }));

/** Mỗi lần bấm một mã: backend dùng nó để không gửi lặp cùng một cú bấm. */
export function newClientId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  const raw = c?.randomUUID ? c.randomUUID().replace(/-/g, "") : Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return raw.slice(0, 24);
}

const activeAccount = () => useMt5Store.getState().accounts.find((a) => a.active);

/** EA đẩy vị thế mới ngay sau khi khớp; hỏi lại sớm để panel/chart cập nhật mà không chờ nhịp poll 2s. */
function refreshSoon() {
  for (const ms of [500, 1500]) setTimeout(() => void useTradeStore.getState().refresh(), ms);
}

/** Báo kết quả bằng toast. `success` là câu cố định hoặc hàm của kết quả (vd chèn loại lệnh EA đã quyết). Trả true nếu sàn đã khớp / nhận lệnh. */
function report(o: TradeOutcome, success: string | ((r: TradeResult) => string), quiet = false, title = "Done"): boolean {
  if (o.kind === "done" && o.result.ok) {
    if (!quiet) toast(typeof success === "string" ? success : success(o.result), { ms: 4000, title, kind: "success" });
    refreshSoon();
    return true;
  }
  if (o.kind === "done") {
    toast(o.result.message || "Sàn từ chối lệnh", { ms: 7000, title: "Order rejected", kind: "error" });
    return false;
  }
  toast(o.message, { ms: o.unknown ? 10_000 : 7000, title: o.unknown ? "Order status unknown" : "Order failed", kind: "error" });
  if (o.unknown) refreshSoon(); // có thể đã khớp: cho người dùng thấy vị thế
  return false;
}

async function run<T>(reason: string, task: (accountId: string) => Promise<T>): Promise<T | undefined> {
  if (useOrderState.getState().busy) return undefined;
  useOrderState.setState({ busy: true });
  try {
    if (!(await useAuthStore.getState().requireLogin(reason))) return undefined;
    const acc = activeAccount();
    if (!acc) {
      toast("Chưa có account MT5 kết nối", { ms: 5000 });
      return undefined;
    }
    return await task(acc.id);
  } finally {
    useOrderState.setState({ busy: false });
  }
}

/** Buy/Sell market `volume` lot (đã chuẩn hoá theo step), kèm SL/TP tuỳ chọn (0 = không đặt). Trả true nếu sàn đã khớp. */
export async function placeMarket(side: "buy" | "sell", symbol: string, volume: number, digits?: number, stops: { sl?: number; tp?: number } = {}): Promise<boolean> {
  const done = await run("Đăng nhập để giao dịch", async (accountId) => {
    const o = await sendMarketOrder(accountId, { symbol, side, volume, sl: stops.sl, tp: stops.tp, clientId: newClientId() });
    const price = o.kind === "done" && o.result.price > 0 ? ` @ ${fmtPx(o.result.price, digits)}` : "";
    return report(o, `${side === "buy" ? "Buy" : "Sell"} ${fmtLot(volume)} ${symbol}${price}`, false, "Order filled");
  });
  return done === true;
}

/** Đóng vị thế `ticket`; `volume` = 0 đóng hết, khác 0 đóng một phần. */
export function closeTrade(ticket: number, symbol: string, volume = 0): Promise<void> {
  return run("Đăng nhập để giao dịch", async (accountId) => {
    const o = await sendClosePosition(accountId, ticket, volume);
    report(o, `Đã đóng ${volume > 0 ? `${fmtLot(volume)} lot của ` : ""}${symbol} #${ticket}`, false, "Position closed");
  }).then(() => undefined);
}

/** Đóng hết các vị thế `tickets` lần lượt trong một lượt (một lệnh bay mỗi lúc); lỗi từng lệnh vẫn toast, cuối cùng toast tổng kết. */
export function closeAllTrades(tickets: number[]): Promise<void> {
  return run("Đăng nhập để giao dịch", async (accountId) => {
    let ok = 0;
    for (const t of tickets) if (report(await sendClosePosition(accountId, t, 0), "", true)) ok++;
    if (ok > 0) toast(`Đã đóng ${ok}/${tickets.length} vị thế`, { ms: 4000, title: "Positions closed", kind: ok === tickets.length ? "success" : "info" });
  }).then(() => undefined);
}

/** Huỷ hết các lệnh chờ `tickets` lần lượt, cùng cách với closeAllTrades. */
export function cancelAllOrders(tickets: number[]): Promise<void> {
  return run("Đăng nhập để giao dịch", async (accountId) => {
    let ok = 0;
    for (const t of tickets) if (report(await sendCancelOrder(accountId, t), "", true)) ok++;
    if (ok > 0) toast(`Đã huỷ ${ok}/${tickets.length} lệnh chờ`, { ms: 4000, title: "Orders cancelled", kind: ok === tickets.length ? "success" : "info" });
  }).then(() => undefined);
}

export type PendingParams = Omit<PendingRequest, "clientId">;

// Một lần đặt lệnh chờ (đã ở trong run). Giá nhảy làm EA chọn loại khác loại web hiển thị thì vẫn đặt (demo) và nói rõ trong toast.
async function pendingCall(accountId: string, r: PendingParams, digits: number | undefined, quiet = false): Promise<boolean> {
  const o = await sendPendingOrder(accountId, { ...r, clientId: newClientId() });
  return report(
    o,
    (res) => {
      const label = isPendingType(res.orderType) ? pendingLabel(res.orderType) : "Lệnh chờ";
      const text = `${label} ${fmtLot(r.volume)} ${r.symbol} @ ${fmtPx(r.price, digits)}`;
      return res.typeChanged ? `Đã đặt ${text} (giá nhảy: loại lệnh đã đổi so với dự kiến)` : text;
    },
    quiet,
    "Pending order placed",
  );
}

/** Đặt lệnh chờ: người dùng chỉ chọn hướng + giá, EA quyết Limit/Stop. Trả true nếu sàn đã nhận lệnh. */
export async function placePending(r: PendingParams, digits?: number): Promise<boolean> {
  return (await run("Đăng nhập để giao dịch", (accountId) => pendingCall(accountId, r, digits))) === true;
}

/** Huỷ lệnh chờ `ticket`. */
export async function cancelOrder(ticket: number, symbol: string): Promise<boolean> {
  return (
    (await run("Đăng nhập để giao dịch", async (accountId) => report(await sendCancelOrder(accountId, ticket), `Đã huỷ lệnh chờ ${symbol} #${ticket}`, false, "Order cancelled"))) === true
  );
}

/** Kéo lệnh chờ tới giá mới (docs/trade-plan.md mục 3.4). Cùng loại thì sửa giá. MT5 không cho đổi loại lệnh chờ: giá vượt qua thị trường thì ĐẶT LỆNH MỚI ĐÚNG LOẠI
 *  TRƯỚC rồi mới xoá lệnh cũ; đặt mới lỗi thì giữ nguyên lệnh cũ. `stops` = SL/TP đổi cùng lúc (gửi chung một yêu cầu, lệnh mới mang theo). */
export async function moveOrder(order: PendingOrder, price: number, digits?: number, stops: { sl?: number; tp?: number } = {}): Promise<boolean> {
  const done = await run("Đăng nhập để giao dịch", async (accountId) => {
    const q = useQuoteStore.getState().quotes[order.symbol];
    const type = isPendingType(order.type) ? order.type : null;
    const resolved = type && q ? resolveOrderType(sideOfType(type), price, q.bid, q.ask) : type;
    if (!type || resolved === type) {
      // cùng loại (hoặc chưa có giá để so: để EA quyết, nó từ chối nếu loại sẽ đổi)
      return report(await sendModifyOrder(accountId, order.ticket, { price, ...stops }), `Đã đổi giá ${order.symbol} #${order.ticket} → ${fmtPx(price, digits)}`, false, "Order modified");
    }
    if (!resolved) {
      toast("Giá vào trùng giá thị trường: lệnh chờ không đặt được ở đó", { ms: 6000 });
      return false;
    }
    const placed = await pendingCall(
      accountId,
      { symbol: order.symbol, side: sideOfType(type), volume: order.volume, price, sl: stops.sl ?? order.sl, tp: stops.tp ?? order.tp, expiration: order.expiration, expectedType: resolved },
      digits,
      true,
    );
    if (!placed) return false; // lệnh cũ còn nguyên
    const del = await sendCancelOrder(accountId, order.ticket);
    if (del.kind === "done" && del.result.ok) {
      toast(`Đã chuyển lệnh #${order.ticket} thành ${pendingLabel(resolved)} ${fmtLot(order.volume)} ${order.symbol} @ ${fmtPx(price, digits)}`, { ms: 5000, title: "Pending order placed", kind: "success" });
    } else {
      toast(`Đã đặt ${pendingLabel(resolved)} mới nhưng chưa xoá được lệnh cũ #${order.ticket}: xoá tay ở tab Orders`, { ms: 12_000, title: "Old order not removed", kind: "error" });
    }
    refreshSoon();
    return true;
  });
  return done === true;
}

export type StopsTarget = { target: "position" | "order"; ticket: number; symbol: string };
export type StopChange = { field: "sl" | "tp"; from: number; to: number };
export type StopTarget = StopsTarget & { field: "sl" | "tp"; from: number };

/** Đổi SL và/hoặc TP của một vị thế / lệnh chờ trong MỘT yêu cầu (backend ghép trường vắng với số liệu EA báo lần cuối, nên hai yêu cầu liền nhau sẽ đè nhau). `to` 0 = bỏ.
 *  Thành công thì toast kèm nút "Hoàn tác" (đặt lại các mức cũ; mức cũ 0 thì hoàn tác = bỏ). `pnlText` = " (+78.30 USD)" nếu biết lãi/lỗi tại mức mới (chỉ khi đổi một mức). */
export async function moveStops(t: StopsTarget, changes: StopChange[], digits?: number, pnlText = ""): Promise<boolean> {
  if (changes.length === 0) return false;
  const names = changes.map((c) => c.field.toUpperCase()).join(" & ");
  const where = `${t.symbol} #${t.ticket}`;
  const patch = (pick: (c: StopChange) => number) => Object.fromEntries(changes.map((c) => [c.field, pick(c)])) as { sl?: number; tp?: number };
  const call = (accountId: string, p: { sl?: number; tp?: number }) =>
    t.target === "position" ? sendModifyPosition(accountId, t.ticket, p) : sendModifyOrder(accountId, t.ticket, p);
  const undo = () =>
    void run("Đăng nhập để giao dịch", async (accountId) => {
      const back = changes.length === 1 && changes[0].from > 0 ? `Đã hoàn tác ${names} ${where} → ${fmtPx(changes[0].from, digits)}` : changes.length === 1 ? `Đã bỏ ${names} ${where}` : `Đã hoàn tác ${names} ${where}`;
      report(await call(accountId, patch((c) => c.from)), back, false, "Order modified");
    });
  const done = await run("Đăng nhập để giao dịch", async (accountId) => {
    const o = await call(accountId, patch((c) => c.to));
    if (o.kind === "done" && o.result.ok) {
      const one = changes[0];
      const text =
        changes.length > 1
          ? `Đã ${changes.every((c) => c.from === 0) ? "đặt" : "đổi"} ${names} ${where}: ${changes.map((c) => (c.to > 0 ? `${c.field.toUpperCase()} → ${fmtPx(c.to, digits)}` : `bỏ ${c.field.toUpperCase()}`)).join(", ")}`
          : one.to > 0
            ? `Đã ${one.from > 0 ? "đổi" : "đặt"} ${names} ${where} → ${fmtPx(one.to, digits)}${pnlText}`
            : `Đã bỏ ${names} ${where}`;
      toast(text, { ms: 8000, title: "Order modified", kind: "success", action: changes.some((c) => c.from !== c.to) ? { label: "Hoàn tác", run: undo } : undefined });
      refreshSoon();
      return true;
    }
    return report(o, "");
  });
  return done === true;
}

/** Kéo SL/TP của vị thế / lệnh chờ tới `price` (0 = bỏ SL/TP, như bấm × trên thẻ): một mức, xem `moveStops`. */
export function moveStop(t: StopTarget, price: number, digits?: number, pnlText = ""): Promise<boolean> {
  return moveStops({ target: t.target, ticket: t.ticket, symbol: t.symbol }, [{ field: t.field, from: t.from, to: price }], digits, pnlText);
}
