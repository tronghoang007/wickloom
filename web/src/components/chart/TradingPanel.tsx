"use client";

import { fmtMoney, MODE_COLOR, MODE_LABEL } from "@/lib/mt5Format";
import type { Position, TradeData } from "@/lib/mt5Api";
import { useAuthStore } from "@/store/auth";
import { useChartStore } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { closeTrade, useOrderState } from "@/trading/actions";
import { dealNet, fmtLot, fmtPnl, fmtPx, fmtTime, isStale, orderLabel, pnlClass, positionPnl, sideLabel, totalPnl } from "@/trading/format";
import { tradeBlock, webTrading } from "@/trading/gate";
import { normalizeLot } from "@/trading/lot";
import { startTradePolling, useTradeStore, type TradeTab } from "@/trading/store";
import { useEffect, useState, type ReactNode } from "react";
import { Chevron } from "../icons";

const TABS: { id: TradeTab; label: string }[] = [
  { id: "positions", label: "Positions" },
  { id: "orders", label: "Orders" },
  { id: "history", label: "History" },
  { id: "account", label: "Account" },
];

const th = "sticky top-0 bg-[var(--bg)] px-3 py-1.5 text-left font-medium text-[var(--muted)]";
const td = "whitespace-nowrap px-3 py-1";

function useNowSec() {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Panel Trading dưới chart (docs/trade-plan.md T1-T2): vị thế, lệnh chờ, lịch sử, tóm tắt account MT5 đang cấp dữ liệu. Chỉ hiện khi đã đăng nhập
 *  và có account MT5 kết nối. Đóng / đóng một phần vị thế ở tab Positions (chỉ account demo); lệnh chờ và sửa SL/TP chưa có (T3-T4). */
export default function TradingPanel() {
  const status = useAuthStore((s) => s.status);
  const loaded = useMt5Store((s) => s.loaded);
  const activeId = useMt5Store((s) => s.accounts.find((a) => a.active)?.id);
  const data = useTradeStore((s) => s.data);
  const open = useTradeStore((s) => s.open);
  const tab = useTradeStore((s) => s.tab);
  const now = useNowSec();

  useEffect(() => {
    if (status === "user" && activeId) return startTradePolling();
    useTradeStore.getState().clear();
  }, [status, activeId]);

  if (status !== "user" || !loaded || !activeId || !data) return null;
  const stale = isStale(data, now);
  const a = data.account;
  const pnl = totalPnl(data.positions);

  return (
    <div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg)]" data-testid="trading-panel">
      <div className="flex h-[34px] items-center gap-1 px-2 text-sm">
        <button
          className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-[var(--hover)]"
          title={open ? "Thu gọn" : "Mở panel Trading"}
          aria-expanded={open}
          onClick={() => useTradeStore.getState().setOpen(!open)}
        >
          <span className={`transition-transform ${open ? "" : "-rotate-90"}`}>
            <Chevron />
          </span>
          <span className="font-semibold">Trading</span>
        </button>
        <span className="flex items-center gap-1.5 px-1 text-xs text-[var(--muted)]">
          <span className="max-w-[160px] truncate">{a.name || a.broker || a.server}</span>
          {MODE_LABEL[a.mode] && (
            <span className="rounded px-1 py-px text-[10px] font-bold text-white" style={{ background: MODE_COLOR[a.mode] }}>
              {MODE_LABEL[a.mode]}
            </span>
          )}
          {stale && <span className="rounded bg-[var(--hover)] px-1 py-px text-[10px]">{a.online ? "dữ liệu cũ" : "offline"}</span>}
        </span>
        <div className="ml-2 flex items-center">
          {TABS.map((t) => {
            const n = t.id === "positions" ? data.positions.length : t.id === "orders" ? data.orders.length : null;
            const on = open && tab === t.id;
            return (
              <button
                key={t.id}
                className={`rounded px-2.5 py-1 text-[13px] hover:bg-[var(--hover)] ${on ? "bg-[var(--hover)] font-semibold" : "text-[var(--muted)]"}`}
                onClick={() => useTradeStore.getState().showTab(t.id)}
              >
                {t.label}
                {n ? <span className="ml-1 text-xs">({n})</span> : null}
              </button>
            );
          })}
        </div>
        <div className={`ml-auto flex items-center gap-4 pr-1 text-xs tabular-nums ${stale ? "opacity-50" : ""}`}>
          <span className="text-[var(--muted)]">
            Equity <span className="text-[var(--fg)]">{fmtMoney(a.equity, a.currency)}</span>
          </span>
          <span className="text-[var(--muted)]">
            P/L <span className={pnlClass(pnl)}>{fmtPnl(pnl)}</span>
          </span>
        </div>
      </div>
      {open && (
        <div className={`h-[180px] overflow-auto border-t border-[var(--border)] ${stale ? "opacity-50" : ""}`}>
          {tab === "positions" && <Positions data={data} />}
          {tab === "orders" && <Orders data={data} />}
          {tab === "history" && <History data={data} />}
          {tab === "account" && <AccountInfo data={data} />}
        </div>
      )}
    </div>
  );
}

const digitsOf = (symbol: string) => useChartStore.getState().symbols.find((s) => s.name === symbol)?.digits;
const showSymbol = (symbol: string) => useChartStore.getState().set({ symbol });
const Empty = ({ children }: { children: ReactNode }) => <div className="px-4 py-6 text-sm text-[var(--muted)]">{children}</div>;

function Positions({ data }: { data: TradeData }) {
  if (data.positions.length === 0) return <Empty>Không có vị thế đang mở.</Empty>;
  return (
    <table className="w-full text-xs tabular-nums">
      <thead>
        <tr>
          {["Symbol", "Side", "Lot", "Entry", "SL", "TP", "Price", "P/L", "Opened", ""].map((h, i) => (
            <th key={i} className={th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.positions.map((p) => (
          <PositionRow key={p.ticket} p={p} account={data.account} />
        ))}
      </tbody>
    </table>
  );
}

// Một vị thế + nút Close. Bấm Close mở ô lot (mặc định cả vị thế): sửa nhỏ hơn rồi OK = đóng một phần, không bước xác nhận riêng (demo).
function PositionRow({ p, account }: { p: Position; account: TradeData["account"] }) {
  const d = digitsOf(p.symbol);
  const pl = positionPnl(p);
  const busy = useOrderState((s) => s.busy);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  // vào được lệnh đóng khi account sẵn sàng; spec/giá chỉ cần cho widget SELL/BUY
  const block = tradeBlock({ replay: false, status: "user", loaded: true, account, spec: { min: 0, max: 0, step: 0 }, hasQuote: true });
  const close = () => {
    const sym = useChartStore.getState().symbols.find((s) => s.name === p.symbol);
    const spec = sym?.volume_min && sym.volume_step ? { min: sym.volume_min, max: p.volume, step: sym.volume_step } : null;
    const want = spec ? normalizeLot(parseFloat(text.replace(",", ".")), spec) : p.volume;
    setEditing(false);
    void closeTrade(p.ticket, p.symbol, want >= p.volume - 1e-9 ? 0 : want); // 0 = đóng hết
  };
  return (
    <tr className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--hover)]" onClick={() => showSymbol(p.symbol)} title="Mở symbol này trên chart">
      <td className={`${td} font-medium`}>{p.symbol}</td>
      <td className={`${td} ${p.type === "buy" ? "text-[#2962ff]" : "text-[#ff9800]"}`}>{sideLabel(p.type)}</td>
      <td className={td}>{fmtLot(p.volume)}</td>
      <td className={td}>{fmtPx(p.price_open, d)}</td>
      <td className={td}>{fmtPx(p.sl, d, true)}</td>
      <td className={td}>{fmtPx(p.tp, d, true)}</td>
      <td className={td}>{fmtPx(p.price_current, d)}</td>
      <td className={`${td} font-medium ${pnlClass(pl)}`}>{fmtPnl(pl)}</td>
      <td className={`${td} text-[var(--muted)]`}>{fmtTime(p.time)}</td>
      <td className={td} onClick={(e) => e.stopPropagation()}>
        {editing ? (
          <span className="flex items-center gap-1">
            <input
              autoFocus
              aria-label="Close lot"
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") close();
                else if (e.key === "Escape") setEditing(false);
              }}
              className="w-14 rounded border border-[var(--border)] bg-transparent px-1 py-0.5 text-center"
            />
            <button className="rounded bg-[#f23645] px-1.5 py-0.5 text-white hover:brightness-110" onClick={close}>OK</button>
            <button className="px-1 text-[var(--muted)] hover:text-[var(--fg)]" aria-label="Cancel" onClick={() => setEditing(false)}>✕</button>
          </span>
        ) : (
          <button
            className="rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--hover)] disabled:opacity-40"
            disabled={block !== null || busy}
            title={block ?? "Đóng vị thế (sửa lot để đóng một phần)"}
            onClick={() => {
              setText(fmtLot(p.volume));
              setEditing(true);
            }}
          >
            Close
          </button>
        )}
      </td>
    </tr>
  );
}

function Orders({ data }: { data: TradeData }) {
  if (data.orders.length === 0) return <Empty>Không có lệnh chờ.</Empty>;
  return (
    <table className="w-full text-xs tabular-nums">
      <thead>
        <tr>
          {["Symbol", "Type", "Lot", "Price", "SL", "TP", "Placed", "Expires"].map((h) => (
            <th key={h} className={th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.orders.map((o) => {
          const d = digitsOf(o.symbol);
          return (
            <tr key={o.ticket} className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--hover)]" onClick={() => showSymbol(o.symbol)} title="Mở symbol này trên chart">
              <td className={`${td} font-medium`}>{o.symbol}</td>
              <td className={td}>{orderLabel(o.type)}</td>
              <td className={td}>{fmtLot(o.volume)}</td>
              <td className={td}>{fmtPx(o.price_open, d)}</td>
              <td className={td}>{fmtPx(o.sl, d, true)}</td>
              <td className={td}>{fmtPx(o.tp, d, true)}</td>
              <td className={`${td} text-[var(--muted)]`}>{fmtTime(o.time_setup)}</td>
              <td className={`${td} text-[var(--muted)]`}>{o.expiration ? fmtTime(o.expiration) : "GTC"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function History({ data }: { data: TradeData }) {
  if (data.deals.length === 0) return <Empty>Chưa có giao dịch nào trong những ngày gần đây.</Empty>;
  return (
    <table className="w-full text-xs tabular-nums">
      <thead>
        <tr>
          {["Time", "Symbol", "Type", "Entry", "Lot", "Price", "Net P/L"].map((h) => (
            <th key={h} className={th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.deals.map((d) => {
          const net = dealNet(d);
          const balance = d.type === "balance";
          return (
            <tr key={d.ticket} className="border-t border-[var(--border)]">
              <td className={`${td} text-[var(--muted)]`}>{fmtTime(d.time)}</td>
              <td className={`${td} font-medium`}>{d.symbol || "—"}</td>
              <td className={td}>{sideLabel(d.type)}</td>
              <td className={td}>{d.entry === "in" ? "In" : d.entry === "out" ? "Out" : d.entry === "inout" ? "In/Out" : "—"}</td>
              <td className={td}>{balance ? "—" : fmtLot(d.volume)}</td>
              <td className={td}>{balance ? "—" : fmtPx(d.price, digitsOf(d.symbol))}</td>
              <td className={`${td} font-medium ${pnlClass(net)}`}>{d.entry === "in" && !net ? "—" : fmtPnl(net)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AccountInfo({ data }: { data: TradeData }) {
  const a = data.account;
  const ccy = a.currency;
  const rows: [string, ReactNode][] = [
    ["Balance", fmtMoney(a.balance, ccy)],
    ["Equity", fmtMoney(a.equity, ccy)],
    ["Open P/L", <span key="p" className={pnlClass(totalPnl(data.positions))}>{fmtPnl(totalPnl(data.positions))}</span>],
    ["Margin", fmtMoney(a.margin, ccy)],
    ["Free margin", fmtMoney(a.margin_free, ccy)],
    ["Margin level", a.margin_level ? `${a.margin_level.toLocaleString("en-US", { maximumFractionDigits: 2 })}%` : "—"],
    ["Leverage", a.leverage ? `1:${a.leverage}` : "—"],
    ["Margin mode", a.margin_mode ? a.margin_mode[0].toUpperCase() + a.margin_mode.slice(1) : "—"],
    ["Login", a.login ? `#${a.login} · ${a.server}` : a.server],
    ["Web trading", webTrading(a)],
  ];
  const warn =
    a.terminal_trade_allowed === false
      ? "Algo Trading đang tắt trên terminal MT5."
      : a.trade_allowed === false
        ? "Account không cho giao dịch (đăng nhập bằng investor password?)."
        : null;
  return (
    <div className="px-4 py-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-8 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-[var(--border)] py-1">
            <span className="text-[var(--muted)]">{k}</span>
            <span className="tabular-nums">{v}</span>
          </div>
        ))}
      </div>
      {warn && <div className="mt-3 text-xs text-[#d69a00]">{warn}</div>}
    </div>
  );
}
