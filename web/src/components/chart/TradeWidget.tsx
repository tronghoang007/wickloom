"use client";

import { useAuthStore } from "@/store/auth";
import { chartGlobal } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { toast } from "@/store/toast";
import { useOrderState } from "@/trading/actions";
import { tradeBlock } from "@/trading/gate";
import { lotSpec } from "@/trading/lot";
import { quoteOf, spreadPips, useQuoteStore } from "@/trading/quote";
import { SIM_ACCOUNT_ID } from "@/trading/simId";
import { useTradeAccount } from "@/trading/store";
import { useTicketStore } from "@/trading/ticket";
import { useMemo } from "react";
import PriceText from "./PriceText";

const sideBtn = "flex min-w-[72px] cursor-pointer flex-col items-center justify-center rounded-md px-2.5 pb-px text-white";

/** Widget SELL | spread | BUY như TradingView, dưới dòng tiêu đề của chart (docs/trade-plan.md T2-T3): bấm thì mở bảng đặt lệnh (OrderTicket, nơi chỉnh lot) cho account MT5 đang cấp dữ liệu.
 *  Chưa đặt được thì nút mờ đi và tooltip/toast nói lý do (tradeBlock); khách bấm thì ra popup đăng nhập. Đang Replay thì đặt lệnh với account giả lập (trading/simStore.ts), khách cũng được. */
/** `bar` (phone): thanh ngang cả bề rộng ở đầu chart (xa tab bar ở đáy cho đỡ bấm nhầm), nút cao 44px cho dễ chạm thay cho widget nhỏ dưới tiêu đề. */
export default function TradeWidget({ symbol, digits, replay, bar = false }: { symbol: string; digits: number; replay: boolean; bar?: boolean }) {
  const quote = useQuoteStore((s) => quoteOf(s, symbol, replay)); // pane khác đang Replay: chart này vẫn hiện giá thật
  const status = useAuthStore((s) => s.status);
  const loaded = useMt5Store((s) => s.loaded);
  const account = useTradeAccount(); // đang Replay: account giả lập, giá là giá replay
  const sym = chartGlobal((s) => s.symbols.find((x) => x.name === symbol));
  const busy = useOrderState((s) => s.busy);
  const spec = useMemo(() => lotSpec(sym, account?.max_lot), [sym, account?.max_lot]);
  const block = tradeBlock({ replay, status, loaded, account, spec, hasQuote: !!quote });

  const click = (side: "buy" | "sell") => {
    if (status === "guest" && account?.id !== SIM_ACCOUNT_ID) {
      void useAuthStore.getState().requireLogin("Đăng nhập để giao dịch");
      return;
    }
    if (block) {
      toast(block, { ms: 6000 });
      return;
    }
    // Bấm SELL / BUY mở bảng đặt lệnh (Market hoặc lệnh chờ, SL/TP, kéo đường trên chart) như TradingView, lot lấy từ lot đã nhớ của account × symbol;
    // bảng đang mở cho symbol này thì chỉ đổi hướng, giữ SL/TP đã soạn
    const t = useTicketStore.getState();
    if (t.draft && t.draft.symbol === symbol) t.patch({ side });
    else t.open({ symbol, side, mode: "market", digits });
  };

  const dim = block !== null || busy ? "opacity-60" : "";
  const size = bar ? "flex-1 py-0.5" : "";
  const price = bar ? "text-[15px] leading-5" : "text-[12px] leading-4";
  return (
    <div className={`pointer-events-auto flex select-none items-stretch gap-1 text-[11px] ${bar ? "h-11" : "mt-1 h-[34px]"}`} data-testid="trade-widget" title={block ?? undefined}>
      <button type="button" aria-label="Sell at market" onClick={() => click("sell")} className={`${sideBtn} ${size} ${dim} bg-[#f23645] hover:brightness-110`}>
        <span className={`${price} font-semibold tabular-nums`}>{quote ? <PriceText value={quote.bid} digits={digits} /> : "—"}</span>
        <span className="text-[11px] leading-3">SELL</span>
      </button>
      <span className="flex min-w-[24px] items-center justify-center text-[10px] text-[var(--muted)] tabular-nums" data-testid="trade-spread" title="Spread (pip)">
        {quote ? spreadPips(quote.bid, quote.ask, digits) : "—"}
      </span>
      <button type="button" aria-label="Buy at market" onClick={() => click("buy")} className={`${sideBtn} ${size} ${dim} bg-[#2962ff] hover:brightness-110`}>
        <span className={`${price} font-semibold tabular-nums`}>{quote ? <PriceText value={quote.ask} digits={digits} /> : "—"}</span>
        <span className="text-[11px] leading-3">BUY</span>
      </button>
    </div>
  );
}
