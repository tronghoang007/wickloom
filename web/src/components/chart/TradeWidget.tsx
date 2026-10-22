"use client";

import { useAuthStore } from "@/store/auth";
import { chartGlobal } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { toast } from "@/store/toast";
import { placeMarket, useOrderState } from "@/trading/actions";
import { tradeBlock } from "@/trading/gate";
import { fmtLotValue, lotSpec, normalizeLot, readLot, stepLot, writeLot } from "@/trading/lot";
import { useQuoteStore } from "@/trading/quote";
import { useMemo, useState } from "react";

const px = (v: number, digits: number) => v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const sideBtn = "flex min-w-[68px] flex-col items-center justify-center px-2.5 text-white";

/** Widget SELL | lot | BUY như TradingView, dưới dòng tiêu đề của chart (docs/trade-plan.md T2): lệnh market trên account MT5 đang cấp dữ liệu.
 *  Chưa gửi được thì nút mờ đi và tooltip/toast nói lý do (tradeBlock); khách bấm thì ra popup đăng nhập. */
export default function TradeWidget({ symbol, digits, replay }: { symbol: string; digits: number; replay: boolean }) {
  const quote = useQuoteStore((s) => s.quotes[symbol]);
  const status = useAuthStore((s) => s.status);
  const loaded = useMt5Store((s) => s.loaded);
  const account = useMt5Store((s) => s.accounts.find((a) => a.active));
  const sym = chartGlobal((s) => s.symbols.find((x) => x.name === symbol));
  const busy = useOrderState((s) => s.busy);
  const spec = useMemo(() => lotSpec(sym, account?.max_lot), [sym, account?.max_lot]);
  const block = tradeBlock({ replay, status, loaded, account, spec, hasQuote: !!quote });
  // Mỗi account × symbol nhớ lot riêng (mặc định = lot tối thiểu của symbol). `typed` chỉ giữ phần người dùng đã gõ/bấm cho đúng account × symbol đó;
  // đổi chart sang symbol khác thì key khác -> tự quay về lot đã nhớ, không cần effect.
  const accountId = account?.id;
  const key = `${accountId ?? ""}|${symbol}`;
  const [typed, setTyped] = useState<{ key: string; text: string } | null>(null);
  const base = useMemo(() => {
    if (!spec) return "";
    const saved = accountId ? readLot(accountId, symbol) : null;
    return fmtLotValue(normalizeLot(saved ?? spec.min, spec), spec);
  }, [accountId, symbol, spec]);
  const text = typed && typed.key === key ? typed.text : base;
  const setText = (t: string) => setTyped({ key, text: t });

  // Chuẩn hoá ô lot (làm tròn theo step, kẹp min/max), nhớ lại, trả số lot sẽ dùng
  const commit = (raw = text): number | null => {
    if (!spec) return null;
    const lot = normalizeLot(parseFloat(raw.replace(",", ".")), spec);
    setText(fmtLotValue(lot, spec));
    if (accountId) writeLot(accountId, symbol, lot);
    return lot;
  };
  const bump = (dir: 1 | -1) => {
    if (!spec) return;
    const cur = normalizeLot(parseFloat(text.replace(",", ".")), spec);
    commit(fmtLotValue(stepLot(cur, dir, spec), spec));
  };

  const click = (side: "buy" | "sell") => {
    if (status === "guest") {
      void useAuthStore.getState().requireLogin("Đăng nhập để giao dịch");
      return;
    }
    if (block) {
      toast(block, { ms: 6000 });
      return;
    }
    const lot = commit();
    if (lot !== null) void placeMarket(side, symbol, lot, digits);
  };

  const dim = block !== null || busy ? "opacity-50" : "";
  return (
    <div className="pointer-events-auto mt-1 flex h-[38px] select-none items-stretch text-[11px]" data-testid="trade-widget" title={block ?? undefined}>
      <button type="button" aria-label="Sell at market" onClick={() => click("sell")} className={`${sideBtn} ${dim} rounded-l bg-[#f23645] hover:brightness-110`}>
        <span className="text-[10px] font-medium leading-none">SELL</span>
        <span className="text-[14px] font-semibold leading-tight tabular-nums">{quote ? px(quote.bid, digits) : "—"}</span>
      </button>
      <div className="flex items-center border-y border-[var(--border)] bg-[var(--bg)] text-[var(--fg)]">
        <button type="button" aria-label="Decrease lot" disabled={!spec} onClick={() => bump(-1)} className="h-full px-1.5 text-[14px] text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-40">
          −
        </button>
        <input
          aria-label="Lot size"
          inputMode="decimal"
          value={spec ? text : "—"}
          readOnly={!spec}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            e.stopPropagation(); // phím trong ô lot không phải phím tắt của chart
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              bump(e.key === "ArrowUp" ? 1 : -1);
            }
          }}
          className="w-[52px] bg-transparent text-center text-[13px] tabular-nums outline-none"
        />
        <button type="button" aria-label="Increase lot" disabled={!spec} onClick={() => bump(1)} className="h-full px-1.5 text-[14px] text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-40">
          +
        </button>
      </div>
      <button type="button" aria-label="Buy at market" onClick={() => click("buy")} className={`${sideBtn} ${dim} rounded-r bg-[#2962ff] hover:brightness-110`}>
        <span className="text-[10px] font-medium leading-none">BUY</span>
        <span className="text-[14px] font-semibold leading-tight tabular-nums">{quote ? px(quote.ask, digits) : "—"}</span>
      </button>
    </div>
  );
}
