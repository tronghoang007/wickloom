import { chartGlobal } from "@/store/chart";
import { useAuthStore } from "@/store/auth";
import { useMt5Store } from "@/store/mt5";
import { askConfirm } from "@/store/confirm";
import { toast } from "@/store/toast";
import { isPhoneNow } from "@/lib/layoutMode";
import { placePending } from "@/trading/actions";
import { fmtLot, orderLabel } from "@/trading/format";
import { tradeBlock } from "@/trading/gate";
import { currentLot, lotSpec } from "@/trading/lot";
import { defaultSide, resolveOrderType, snapPrice, type Side } from "@/trading/orderType";
import { quoteOf, useQuoteStore } from "@/trading/quote";
import { SIM_ACCOUNT_ID } from "@/trading/simId";
import { tradeAccount } from "@/trading/store";
import { accountRows } from "@/trading/tagActions";
import { useTicketStore } from "@/trading/ticket";
import { AddOrderI, BuyI, SellI } from "../icons";
import type { MenuItem } from "./ChartContextMenu";

const px = (v: number, digits: number) => v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Ba dòng giao dịch của menu chuột phải (docs/trade-plan.md mục 4): Limit và Stop tại giá bấm chuột + "Add order". Dòng nào là Limit / Stop do giá bấm so với thị trường:
 *  trên thị trường là Sell limit + Buy stop, dưới thị trường là Buy limit + Sell stop. Nhãn Limit / Stop của từng dòng lấy đúng loại EA sẽ đặt (Buy so với Ask, Sell so với Bid):
 *  bấm trong spread thì cả hai dòng đều là Limit, đúng giá thị trường thì dòng đó tắt. Chưa gửi được (chưa đăng nhập, real, EA tắt...) thì bấm sẽ nói lý do. */
export function tradeMenuItems(symbol: string, price: number | null, digits: number, lastClose: number | undefined, replay: boolean): MenuItem[] {
  const q = quoteOf(useQuoteStore.getState(), symbol, replay);
  const mid = q ? (q.bid + q.ask) / 2 : lastClose;
  const above = price !== null && mid !== undefined && price >= mid;
  const sym = chartGlobal.getState().symbols.find((s) => s.name === symbol);
  const account = tradeAccount();
  const spec = lotSpec(sym, account?.max_lot);
  const lot = spec ? currentLot(account?.id, symbol, spec) : null;
  const p = price === null ? "" : px(price, digits);
  const snapped = price === null ? null : snapPrice(price, sym?.tick_size ?? 10 ** -digits, digits);

  // Chuột phải đã chọn một giá: dùng giá đó (làm tròn theo tick), lot đã nhớ của account × symbol
  const order = (side: Side) => () => {
    if (snapped === null) return;
    const auth = useAuthStore.getState();
    if (auth.status === "guest" && account?.id !== SIM_ACCOUNT_ID) {
      void auth.requireLogin("Đăng nhập để giao dịch");
      return;
    }
    const cur = quoteOf(useQuoteStore.getState(), symbol, replay);
    const block = tradeBlock({ replay, status: auth.status, loaded: useMt5Store.getState().loaded, account, spec, hasQuote: !!cur });
    if (block || lot === null) {
      toast(block ?? "Chưa có thông số lot của symbol", { ms: 6000 });
      return;
    }
    const expectedType = cur ? resolveOrderType(side, snapped, cur.bid, cur.ask) : null;
    const place = () => placePending({ symbol, side, volume: lot, price: snapped, expectedType }, digits);
    if (!isPhoneNow()) return void place(); // desktop: đặt ngay như TradingView
    // phone: chạm nhầm dễ hơn chuột phải, luôn hỏi trước (docs/mobile-responsive-plan.md mục 9)
    askConfirm({
      title: "Đặt lệnh chờ",
      rows: [
        ...accountRows(),
        { label: "Lệnh", value: `${(expectedType ? orderLabel(expectedType) : side).toUpperCase()} ${fmtLot(lot)} ${symbol}`, tone: side },
        { label: "Giá", value: px(snapped, digits) },
      ],
      confirmLabel: "Đặt lệnh",
      onConfirm: place,
    });
  };
  const lotText = lot === null ? "1" : fmtLot(lot);
  const limitSide: Side = above ? "sell" : "buy";
  const stopSide: Side = above ? "buy" : "sell";
  // nhãn theo loại sẽ thật sự đặt; chưa có giá thị trường thì theo ý định của dòng
  const row = (side: Side, intended: "limit" | "stop"): Exclude<MenuItem, "sep"> => {
    const t = q && snapped !== null ? resolveOrderType(side, snapped, q.bid, q.ask) : undefined;
    const word = t ? (t.endsWith("limit") ? "limit" : "stop") : intended;
    return {
      label: `${side === "sell" ? "Sell" : "Buy"} ${lotText} ${symbol} @ ${p} ${word}`,
      icon: side === "sell" ? <SellI /> : <BuyI />,
      disabled: price === null || t === null, // t null = đúng giá thị trường: không đặt lệnh chờ được
      onSelect: order(side),
    };
  };
  return [
    { ...row(limitSide, "limit"), shortcut: "⌥ ⇧ S" },
    row(stopSide, "stop"),
    {
      label: `Add order on ${symbol} at ${p}`,
      icon: <AddOrderI />,
      shortcut: "⇧ T",
      disabled: price === null,
      onSelect: () => {
        if (snapped === null) return;
        const cur = quoteOf(useQuoteStore.getState(), symbol, replay);
        useTicketStore.getState().open({ symbol, price: snapped, digits, mode: "pending", side: cur ? defaultSide(snapped, cur.bid, cur.ask) : limitSide });
      },
    },
  ];
}
