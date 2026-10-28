import { chartGlobal } from "@/store/chart";
import { useAuthStore } from "@/store/auth";
import { useMt5Store } from "@/store/mt5";
import { toast } from "@/store/toast";
import { placePending } from "@/trading/actions";
import { fmtLot } from "@/trading/format";
import { tradeBlock } from "@/trading/gate";
import { currentLot, lotSpec } from "@/trading/lot";
import { defaultSide, resolveOrderType, snapPrice, type Side } from "@/trading/orderType";
import { useQuoteStore } from "@/trading/quote";
import { SIM_ACCOUNT_ID } from "@/trading/simId";
import { tradeAccount } from "@/trading/store";
import { useTicketStore } from "@/trading/ticket";
import { AddOrderI, BuyI, SellI } from "../icons";
import type { MenuItem } from "./ChartContextMenu";

const px = (v: number, digits: number) => v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Ba dòng giao dịch của menu chuột phải (docs/trade-plan.md mục 4): Limit và Stop tại giá bấm chuột + "Add order". Dòng nào là Limit / Stop do giá bấm so với thị trường:
 *  trên thị trường là Sell limit + Buy stop, dưới thị trường là Buy limit + Sell stop. Chưa gửi được (chưa đăng nhập, real, EA tắt...) thì bấm sẽ nói lý do. */
export function tradeMenuItems(symbol: string, price: number | null, digits: number, lastClose: number | undefined, replay: boolean): MenuItem[] {
  const q = useQuoteStore.getState().quotes[symbol];
  const mid = q ? (q.bid + q.ask) / 2 : lastClose;
  const above = price !== null && mid !== undefined && price >= mid;
  const sym = chartGlobal.getState().symbols.find((s) => s.name === symbol);
  const account = tradeAccount();
  const spec = lotSpec(sym, account?.max_lot);
  const lot = spec ? currentLot(account?.id, symbol, spec) : null;
  const p = price === null ? "" : px(price, digits);

  // Chuột phải đã chọn một giá: dùng giá đó (làm tròn theo tick), lot đã nhớ của account × symbol
  const order = (side: Side) => () => {
    if (price === null) return;
    const auth = useAuthStore.getState();
    if (auth.status === "guest" && account?.id !== SIM_ACCOUNT_ID) {
      void auth.requireLogin("Đăng nhập để giao dịch");
      return;
    }
    const cur = useQuoteStore.getState().quotes[symbol];
    const block = tradeBlock({ replay, status: auth.status, loaded: useMt5Store.getState().loaded, account, spec, hasQuote: !!cur });
    if (block || lot === null) {
      toast(block ?? "Chưa có thông số lot của symbol", { ms: 6000 });
      return;
    }
    const at = snapPrice(price, sym?.tick_size ?? 10 ** -digits, digits);
    const expectedType = cur ? resolveOrderType(side, at, cur.bid, cur.ask) : null;
    void placePending({ symbol, side, volume: lot, price: at, expectedType }, digits);
  };
  const lotText = lot === null ? "1" : fmtLot(lot);
  const limitSide: Side = above ? "sell" : "buy";
  const stopSide: Side = above ? "buy" : "sell";
  return [
    { label: `${above ? "Sell" : "Buy"} ${lotText} ${symbol} @ ${p} limit`, icon: above ? <SellI /> : <BuyI />, shortcut: "⌥ ⇧ S", disabled: price === null, onSelect: order(limitSide) },
    { label: `${above ? "Buy" : "Sell"} ${lotText} ${symbol} @ ${p} stop`, icon: above ? <BuyI /> : <SellI />, disabled: price === null, onSelect: order(stopSide) },
    {
      label: `Add order on ${symbol} at ${p}`,
      icon: <AddOrderI />,
      shortcut: "⇧ T",
      disabled: price === null,
      onSelect: () => {
        if (price === null) return;
        const cur = useQuoteStore.getState().quotes[symbol];
        useTicketStore.getState().open({ symbol, price: snapPrice(price, sym?.tick_size ?? 10 ** -digits, digits), digits, mode: "pending", side: cur ? defaultSide(price, cur.bid, cur.ask) : limitSide });
      },
    },
  ];
}
