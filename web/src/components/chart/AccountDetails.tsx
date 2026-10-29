"use client";

import { fmtMoney } from "@/lib/mt5Format";
import type { TradeData } from "@/lib/mt5Api";
import { dealSummary, fmtPnl, pnlClass, todayStart } from "@/trading/format";
import { webTrading } from "@/trading/gate";
import { useState, type ReactNode } from "react";

/** Thông tin account không nằm trong dải số của panel Trading, hiện dưới account đang cấp dữ liệu ở dropdown avatar: Margin mode, Web trading, tổng hợp
 *  lịch sử như dòng tổng tab History của MT5 (Profit, Deposit, Withdrawal, Credit, Swap, Commission), cảnh báo không giao dịch được. Login / leverage đã có ở dòng phụ của account. */
export default function AccountDetails({ data }: { data: TradeData }) {
  const a = data.account;
  const ccy = a.currency;
  const [now] = useState(() => Date.now() / 1000); // "hôm nay" tính lúc mở; đóng mở lại là cập nhật
  // Toàn bộ lịch sử do EA >= 2.22 cộng sẵn: khớp số MT5 (user 10-29: MT5 Profit 2.45 = Balance 102.45 - Deposit 100, app hôm nay +3.75). EA chỉ gửi deal 30 ngày nên web
  // không tự cộng ra được; EA cũ thì đành tổng hợp deal hôm nay và ghi rõ khoảng.
  const all = data.summary;
  const sum = all ?? dealSummary(data.deals.filter((d) => d.time >= todayStart(now)));
  const money = (v: number) => (
    <span className={pnlClass(v)}>
      {fmtPnl(v)}
      {ccy ? ` ${ccy}` : ""}
    </span>
  );
  // chưa có deal nào thì bỏ cả cụm lịch sử
  const history: [string, ReactNode][] =
    !all && data.deals.length === 0
      ? []
      : [
          ["History", <span key="p" className="text-[var(--muted)]">{all ? "Toàn bộ" : "Hôm nay"}</span>],
          ["Profit", money(sum.profit)],
          ["Deposit", fmtMoney(sum.deposit, ccy)],
          ...(sum.withdrawal ? ([["Withdrawal", fmtMoney(-sum.withdrawal, ccy)]] as [string, ReactNode][]) : []),
          ...(all?.credit ? ([["Credit", fmtMoney(all.credit, ccy)]] as [string, ReactNode][]) : []),
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
