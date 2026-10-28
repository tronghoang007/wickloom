"use client";

import { fmtMoney } from "@/lib/mt5Format";
import type { TradeData } from "@/lib/mt5Api";
import { dealSummary, fmtPnl, pnlClass } from "@/trading/format";
import { webTrading } from "@/trading/gate";
import type { ReactNode } from "react";

/** Thông tin account không nằm trong dải số của panel Trading, hiện dưới account đang cấp dữ liệu ở dropdown avatar: Margin mode, Web trading, tổng hợp
 *  lịch sử deal gần đây như màn History của MT5 (Profit đã đóng, Deposit, Withdrawal, Swap, Commission), cảnh báo không giao dịch được. Login / leverage đã có ở dòng phụ của account. */
export default function AccountDetails({ data }: { data: TradeData }) {
  const a = data.account;
  const ccy = a.currency;
  const sum = dealSummary(data.deals);
  const money = (v: number) => (
    <span className={pnlClass(v)}>
      {fmtPnl(v)}
      {ccy ? ` ${ccy}` : ""}
    </span>
  );
  // chưa có deal nào thì bỏ cả cụm lịch sử
  const history: [string, ReactNode][] =
    data.deals.length === 0
      ? []
      : [
          ["Realized P/L", money(sum.profit)],
          ["Deposit", fmtMoney(sum.deposit, ccy)],
          ...(sum.withdrawal ? ([["Withdrawal", fmtMoney(-sum.withdrawal, ccy)]] as [string, ReactNode][]) : []),
          ["Swap", money(sum.swap)],
          ["Commission", money(sum.commission)],
        ];
  const rows: [string, ReactNode][] = [
    ["Margin mode", a.margin_mode ? a.margin_mode[0].toUpperCase() + a.margin_mode.slice(1) : "—"],
    ["Web trading", webTrading(a)],
    ...history,
  ];
  const warn =
    a.terminal_trade_allowed === false
      ? "Algo Trading đang tắt trên terminal MT5."
      : a.trade_allowed === false
        ? "Account không cho giao dịch (đăng nhập bằng investor password?)."
        : null;
  return (
    <div className="mt-1 pl-4 text-[13px]" data-testid="account-details">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 py-0.5">
          <span className="text-[var(--muted)]">{k}</span>
          <span className="text-right tabular-nums">{v}</span>
        </div>
      ))}
      {warn && <div className="mt-1 text-xs text-[#d69a00]">{warn}</div>}
    </div>
  );
}
