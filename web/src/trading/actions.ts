import { sendClosePosition, sendMarketOrder, type TradeOutcome } from "@/lib/tradeApi";
import { useAuthStore } from "@/store/auth";
import { useMt5Store } from "@/store/mt5";
import { toast } from "@/store/toast";
import { create } from "zustand";
import { fmtLot, fmtPx } from "./format";
import { useTradeStore } from "./store";

// Hành động giao dịch của người dùng (docs/trade-plan.md T2): luôn qua requireLogin, mỗi lần chỉ một lệnh đang bay, kết quả báo bằng toast.
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

function report(o: TradeOutcome, success: string): boolean {
  if (o.kind === "done" && o.result.ok) {
    toast(success, { ms: 4000 });
    refreshSoon();
    return true;
  }
  if (o.kind === "done") {
    toast(o.result.message || "Sàn từ chối lệnh", { ms: 7000 });
    return false;
  }
  toast(o.message, { ms: o.unknown ? 10_000 : 7000 });
  if (o.unknown) refreshSoon(); // có thể đã khớp: cho người dùng thấy vị thế
  return false;
}

async function run(reason: string, task: (accountId: string) => Promise<void>): Promise<void> {
  if (useOrderState.getState().busy) return;
  useOrderState.setState({ busy: true });
  try {
    if (!(await useAuthStore.getState().requireLogin(reason))) return;
    const acc = activeAccount();
    if (!acc) {
      toast("Chưa có account MT5 kết nối", { ms: 5000 });
      return;
    }
    await task(acc.id);
  } finally {
    useOrderState.setState({ busy: false });
  }
}

/** Buy/Sell market `volume` lot (đã chuẩn hoá theo step). */
export function placeMarket(side: "buy" | "sell", symbol: string, volume: number, digits?: number): Promise<void> {
  return run("Đăng nhập để giao dịch", async (accountId) => {
    const o = await sendMarketOrder(accountId, { symbol, side, volume, clientId: newClientId() });
    const price = o.kind === "done" && o.result.price > 0 ? ` @ ${fmtPx(o.result.price, digits)}` : "";
    report(o, `${side === "buy" ? "Buy" : "Sell"} ${fmtLot(volume)} ${symbol}${price}`);
  });
}

/** Đóng vị thế `ticket`; `volume` = 0 đóng hết, khác 0 đóng một phần. */
export function closeTrade(ticket: number, symbol: string, volume = 0): Promise<void> {
  return run("Đăng nhập để giao dịch", async (accountId) => {
    const o = await sendClosePosition(accountId, ticket, volume);
    report(o, `Đã đóng ${volume > 0 ? `${fmtLot(volume)} lot của ` : ""}${symbol} #${ticket}`);
  });
}
