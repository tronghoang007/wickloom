"use client";

import { fmtMoney, MODE_COLOR, MODE_LABEL } from "@/lib/mt5Format";
import type { PendingOrder, Position, TradeData } from "@/lib/mt5Api";
import { useAuthStore } from "@/store/auth";
import { useChartStore } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { cancelOrder, useOrderState } from "@/trading/actions";
import { askClosePosition } from "@/trading/tagActions";
import { accountProfit, dealNet, fmtLot, fmtPnl, fmtPx, fmtTime, isStale, orderLabel, pnlClass, positionPnl, sideLabel } from "@/trading/format";
import { tradeBlock } from "@/trading/gate";
import { useTradeFocus } from "@/trading/focus";
import { normalizeLot } from "@/trading/lot";
import { startTradePolling, useTradeStore, type TradeTab } from "@/trading/store";
import { useEffect, useState, type ReactNode } from "react";
import { Chevron } from "../icons";

const TABS: { id: TradeTab; label: string }[] = [
  { id: "positions", label: "Positions" },
  { id: "orders", label: "Orders" },
  { id: "history", label: "History" },
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
  const pnl = accountProfit(data);
  const ccy = a.currency;
  // Unrealized P/L và Margin level chỉ có nghĩa khi đang có lệnh (MT5 báo margin level 0 khi chưa dùng margin)
  const stats: [string, string, string?][] = [
    ["Equity", fmtMoney(a.equity, ccy)],
    ["Free Margin", fmtMoney(a.margin_free, ccy)],
    ["Margin", fmtMoney(a.margin, ccy)],
    ["Balance", fmtMoney(a.balance, ccy)],
    ...(data.positions.length > 0 ? ([["Unrealized P/L", fmtPnl(pnl), pnlClass(pnl)]] as [string, string, string?][]) : []),
    ...(a.margin_level ? ([["Margin level", `${a.margin_level.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`]] as [string, string, string?][]) : []),
  ];

  return (
    <div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg)]" data-testid="trading-panel">
      <div className="flex h-[34px] items-center gap-1 px-2 text-sm">
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 hover:bg-[var(--hover)]"
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
                className={`cursor-pointer rounded px-2.5 py-1 text-[13px] hover:bg-[var(--hover)] ${on ? "bg-[var(--hover)] font-semibold" : "text-[var(--muted)]"}`}
                onClick={() => useTradeStore.getState().showTab(t.id)}
              >
                {t.label}
                {n ? <span className="ml-1 text-xs">({n})</span> : null}
              </button>
            );
          })}
        </div>
        <div className={`ml-auto flex min-w-0 items-center gap-4 overflow-hidden pr-1 text-xs tabular-nums ${stale ? "opacity-50" : ""}`} data-testid="account-summary">
          {stats.map(([k, v, cls]) => (
            <span key={k} className="whitespace-nowrap text-[var(--muted)]">
              {k} <span className={cls ?? "text-[var(--fg)]"}>{v}</span>
            </span>
          ))}
        </div>
      </div>
      {open && (
        <div className={`h-[180px] overflow-auto border-t border-[var(--border)] ${stale ? "opacity-50" : ""}`}>
          {tab === "positions" && <Positions data={data} />}
          {tab === "orders" && <Orders data={data} />}
          {tab === "history" && <History data={data} />}
        </div>
      )}
    </div>
  );
}

const digitsOf = (symbol: string) => useChartStore.getState().symbols.find((s) => s.name === symbol)?.digits;
const showSymbol = (symbol: string) => useChartStore.getState().set({ symbol });

/** Bấm một dòng vị thế / lệnh chờ: mở symbol của nó trên chart và focus lệnh đó (đường + thẻ của nó sáng lên, lệnh khác mờ đi: xem `trading/focus.ts`); bấm lại đúng dòng đó thì bỏ focus. */
function pickRow(owner: string, symbol: string) {
  const f = useTradeFocus.getState();
  f.set(f.owner === owner ? null : owner);
  showSymbol(symbol);
}
const rowClass = (focused: boolean) =>
  `cursor-pointer border-t border-[var(--border)] hover:bg-[var(--hover)] ${focused ? "bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]" : ""}`;
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

// Một vị thế + nút Close. Bấm Close mở ô lot (mặc định cả vị thế): sửa nhỏ hơn rồi OK = đóng một phần; OK mở hộp thoại xác nhận (cùng hộp với dấu × trên chart).
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
    askClosePosition(p, want >= p.volume - 1e-9 ? 0 : want); // hộp thoại xác nhận rồi mới gửi; 0 = đóng hết
  };
  const owner = `position:${p.ticket}`;
  const focused = useTradeFocus((s) => s.owner === owner);
  return (
    <tr className={rowClass(focused)} onClick={() => pickRow(owner, p.symbol)} title="Mở symbol này trên chart và làm sáng lệnh trên biểu đồ" aria-selected={focused}>
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
            <button className="cursor-pointer rounded bg-[#f23645] px-1.5 py-0.5 text-white hover:brightness-110" onClick={close}>OK</button>
            <button className="cursor-pointer px-1 text-[var(--muted)] hover:text-[var(--fg)]" aria-label="Cancel" onClick={() => setEditing(false)}>✕</button>
          </span>
        ) : (
          <button
            className="cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40"
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
          {["Symbol", "Type", "Lot", "Price", "SL", "TP", "Placed", "Expires", ""].map((h, i) => (
            <th key={i} className={th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.orders.map((o) => (
          <OrderRow key={o.ticket} o={o} account={data.account} />
        ))}
      </tbody>
    </table>
  );
}

// Một lệnh chờ + nút Cancel (huỷ ngay, chỉ account demo). Đổi giá bằng cách kéo đường lệnh trên chart.
function OrderRow({ o, account }: { o: PendingOrder; account: TradeData["account"] }) {
  const d = digitsOf(o.symbol);
  const busy = useOrderState((s) => s.busy);
  const block = tradeBlock({ replay: false, status: "user", loaded: true, account, spec: { min: 0, max: 0, step: 0 }, hasQuote: true });
  const owner = `order:${o.ticket}`;
  const focused = useTradeFocus((s) => s.owner === owner);
  return (
    <tr className={rowClass(focused)} onClick={() => pickRow(owner, o.symbol)} title="Mở symbol này trên chart và làm sáng lệnh trên biểu đồ" aria-selected={focused}>
      <td className={`${td} font-medium`}>{o.symbol}</td>
      <td className={td}>{orderLabel(o.type)}</td>
      <td className={td}>{fmtLot(o.volume)}</td>
      <td className={td}>{fmtPx(o.price_open, d)}</td>
      <td className={td}>{fmtPx(o.sl, d, true)}</td>
      <td className={td}>{fmtPx(o.tp, d, true)}</td>
      <td className={`${td} text-[var(--muted)]`}>{fmtTime(o.time_setup)}</td>
      <td className={`${td} text-[var(--muted)]`}>{o.expiration ? fmtTime(o.expiration) : "GTC"}</td>
      <td className={td} onClick={(e) => e.stopPropagation()}>
        <button
          className="cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40"
          disabled={block !== null || busy}
          title={block ?? "Huỷ lệnh chờ"}
          onClick={() => void cancelOrder(o.ticket, o.symbol)}
        >
          Cancel
        </button>
      </td>
    </tr>
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
