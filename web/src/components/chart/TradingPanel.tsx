"use client";

import { fmtMoney, MODE_COLOR, MODE_LABEL } from "@/lib/mt5Format";
import type { PendingOrder, Position, TradeData } from "@/lib/mt5Api";
import { useAuthStore } from "@/store/auth";
import { useChartStore } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { cancelOrder, useOrderState } from "@/trading/actions";
import { askCancelAll, askCloseAll, askClosePosition } from "@/trading/tagActions";
import { accountProfit, closedPositions, dealNet, fmtLot, fmtPnl, fmtPx, fmtTime, isStale, orderLabel, pnlClass, positionPnl, REASON_LABEL, sideLabel } from "@/trading/format";
import { tradeBlock } from "@/trading/gate";
import { normalizeLot } from "@/trading/lot";
import { startTradePolling, useTradeStore, type TradeTab } from "@/trading/store";
import { useEffect, useState, type ReactNode } from "react";
import { Chevron } from "../icons";
import { SymbolBadge } from "../SymbolIcon";

const TABS: { id: TradeTab; label: string }[] = [
  { id: "positions", label: "Positions" },
  { id: "orders", label: "Orders" },
  { id: "history", label: "History" },
];


// Bảng kiểu TradingView (Positions / Orders / History): tiêu đề mờ có đường kẻ dưới, số căn phải, mỗi dòng cách nhau một đường kẻ mảnh
const th = "sticky top-0 z-[1] whitespace-nowrap border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-left font-normal text-[var(--muted)]";
const td = "whitespace-nowrap px-3 py-2.5";
const R = " text-right";
const symbolType = (symbol: string) => useChartStore.getState().symbols.find((s) => s.name === symbol)?.type;
function SymbolCell({ symbol }: { symbol: string }) {
  return (
    <span className="flex items-center gap-2 font-medium">
      <SymbolBadge name={symbol} type={symbolType(symbol)} size={20} />
      {symbol}
    </span>
  );
}
const SideCell = ({ side, label = sideLabel(side) }: { side: "buy" | "sell"; label?: string }) => (
  <span className="flex items-center gap-1.5">
    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: side === "buy" ? "#2962ff" : "#ff9800" }} />
    {label}
  </span>
);
function Head({ cols, all }: { cols: [string, boolean?][]; all?: { label: string; disabled?: boolean; title?: string; run: () => void } }) {
  return (
    <thead>
      <tr>
        {cols.map(([h, right], i) => (
          <th key={i} className={(all && i === cols.length - 1 ? th.replace("text-left", "text-right") : th) + (right ? R : "")}>
            {all && i === cols.length - 1 ? (
              <button
                className="cursor-pointer rounded border border-[#f23645] px-2 py-0.5 text-[#f23645] hover:bg-[#f23645]/15 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={all.disabled}
                title={all.title}
                onClick={all.run}
              >
                {all.label}
              </button>
            ) : (
              h
            )}
          </th>
        ))}
      </tr>
    </thead>
  );
}


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
const rowClass = "border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--hover)]";
const Empty = ({ children }: { children: ReactNode }) => <div className="px-4 py-6 text-sm text-[var(--muted)]">{children}</div>;

function Positions({ data }: { data: TradeData }) {
  const busy = useOrderState((s) => s.busy);
  if (data.positions.length === 0) return <Empty>Không có vị thế đang mở.</Empty>;
  const block = tradeBlock({ replay: false, status: "user", loaded: true, account: data.account, spec: { min: 0, max: 0, step: 0 }, hasQuote: true });
  return (
    <table className="w-full text-xs tabular-nums">
      <Head
        cols={[["Symbol"], ["Side"], ["Lot", true], ["Entry", true], ["SL", true], ["TP", true], ["Price", true], ["P/L", true], ["Opened"], [""]]}
        all={{ label: "Close all", disabled: block !== null || busy, title: block ?? "Đóng tất cả vị thế", run: () => askCloseAll(data.positions) }}
      />
      <tbody>
        {data.positions.map((p) => (
          <PositionRow key={p.ticket} p={p} account={data.account} />
        ))}
      </tbody>
    </table>
  );
}

/** Thanh kéo đóng một phần theo % của vị thế (như MT5): mốc 20 / 40 / 60 / 80 / 100% là chấm tròn có nhãn %, đường kẻ 1px, đoạn đã chọn tô đỏ, núm tròn. Giá trị ra là lot đã chuẩn hoá theo step.
 *  Input range thật nằm đè lên để kéo / dùng phím. */
const SLIDER_MARKS = [20, 40, 60, 80, 100];
function LotSlider({ spec, value, onChange }: { spec: { min: number; max: number; step: number }; value: number; onChange: (lot: number) => void }) {
  const pct = Math.min(100, Math.max(0, (value / spec.max) * 100));
  return (
    <span className="relative mx-1 flex h-5 w-56 items-center">
      <span className="pointer-events-none absolute inset-x-2 inset-y-0 flex items-center">
        <span className="absolute inset-x-0 h-px bg-[var(--border)]" />
        <span className="absolute left-0 h-px bg-[#f23645]" style={{ width: `${pct}%` }} />
        {SLIDER_MARKS.map((m) => (
          <span key={m} className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: `${m}%` }}>
            <span className={`h-2 w-2 rounded-full ${m <= pct + 1e-6 ? "bg-[#f23645]" : "bg-[var(--muted)]"}`} />
            <span className="absolute top-3.5 text-[10px] leading-none text-[var(--muted)]">{m}%</span>
          </span>
        ))}
      </span>
      <input
        type="range"
        aria-label="Close percent slider"
        min={0}
        max={100}
        step={0.1}
        value={pct}
        onChange={(e) => onChange(normalizeLot((parseFloat(e.target.value) / 100) * spec.max, spec))}
        className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none bg-transparent focus:outline-none [&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent [&::-webkit-slider-thumb]:mt-0.5 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#f23645] [&::-webkit-slider-thumb]:bg-[var(--bg)] [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-solid [&::-moz-range-thumb]:border-[#f23645] [&::-moz-range-thumb]:bg-[var(--bg)]"
      />
    </span>
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
  const sym = useChartStore.getState().symbols.find((s) => s.name === p.symbol);
  const spec = sym?.volume_min && sym.volume_step ? { min: sym.volume_min, max: p.volume, step: sym.volume_step } : null;
  const canPartial = spec !== null && p.volume > spec.min + 1e-9; // lot lớn hơn lot tối thiểu thì mới đóng một phần được
  const want0 = spec ? normalizeLot(parseFloat(text.replace(",", ".")), spec) : p.volume;
  const close = () => {
    const want = spec ? normalizeLot(parseFloat(text.replace(",", ".")), spec) : p.volume;
    setEditing(false);
    askClosePosition(p, want >= p.volume - 1e-9 ? 0 : want); // hộp thoại xác nhận rồi mới gửi; 0 = đóng hết
  };
  return (
    <tr className={rowClass}>
      <td className={td}><SymbolCell symbol={p.symbol} /></td>
      <td className={td}><SideCell side={p.type === "sell" ? "sell" : "buy"} /></td>
      <td className={td + R}>{fmtLot(p.volume)}</td>
      <td className={td + R}>{fmtPx(p.price_open, d)}</td>
      <td className={td + R}>{fmtPx(p.sl, d, true)}</td>
      <td className={td + R}>{fmtPx(p.tp, d, true)}</td>
      <td className={td + R}>{fmtPx(p.price_current, d)}</td>
      <td className={`${td}${R} font-medium ${pnlClass(pl)}`}>{fmtPnl(pl)}</td>
      <td className={`${td} text-[var(--muted)]`}>{fmtTime(p.time)}</td>
      <td className={td + " relative text-right"} onClick={(e) => e.stopPropagation()}>
        <button
          className={`cursor-pointer rounded border border-[#f23645] px-2 py-0.5 text-[#f23645] hover:bg-[#f23645]/15 disabled:cursor-not-allowed disabled:opacity-40 ${editing ? "invisible" : ""}`}
          disabled={block !== null || busy}
          title={block ?? (canPartial ? "Đóng vị thế (kéo thanh hoặc sửa lot để đóng một phần)" : "Đóng vị thế")}
          onClick={() => {
            if (!canPartial) return askClosePosition(p); // không chia nhỏ được: đóng hết (có hộp xác nhận)
            setText(fmtLot(p.volume));
            setEditing(true);
          }}
        >
          Close
        </button>
        {editing && (
          // nổi lên trên hàng (không đẩy các cột khác), cao đúng bằng hàng, neo bên phải
          <span className="absolute inset-y-0 right-0 z-10 flex items-center justify-center gap-3 border-l border-[var(--border)] bg-[var(--bg)] px-3 shadow-lg">
            {spec && <LotSlider spec={spec} value={Number.isFinite(want0) ? want0 : spec.max} onChange={(lot) => setText(fmtLot(lot))} />}
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
              className="w-16 rounded border border-[var(--border)] bg-transparent px-1.5 py-1 text-center"
            />
            <button className="cursor-pointer rounded bg-[#f23645] px-3 py-1 text-white hover:brightness-110" onClick={close}>OK</button>
            <button className="cursor-pointer px-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]" aria-label="Cancel" onClick={() => setEditing(false)}>✕</button>
          </span>
        )}
      </td>
    </tr>
  );
}

function Orders({ data }: { data: TradeData }) {
  const busy = useOrderState((s) => s.busy);
  if (data.orders.length === 0) return <Empty>Không có lệnh chờ.</Empty>;
  const block = tradeBlock({ replay: false, status: "user", loaded: true, account: data.account, spec: { min: 0, max: 0, step: 0 }, hasQuote: true });
  return (
    <table className="w-full text-xs tabular-nums">
      <Head
        cols={[["Symbol"], ["Type"], ["Lot", true], ["Price", true], ["SL", true], ["TP", true], ["Placed"], ["Expires"], [""]]}
        all={{ label: "Cancel all", disabled: block !== null || busy, title: block ?? "Huỷ tất cả lệnh chờ", run: () => askCancelAll(data.orders) }}
      />
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
  return (
    <tr className={rowClass}>
      <td className={td}><SymbolCell symbol={o.symbol} /></td>
      <td className={td}><SideCell side={o.type.startsWith("buy") ? "buy" : "sell"} label={orderLabel(o.type)} /></td>
      <td className={td + R}>{fmtLot(o.volume)}</td>
      <td className={td + R}>{fmtPx(o.price_open, d)}</td>
      <td className={td + R}>{fmtPx(o.sl, d, true)}</td>
      <td className={td + R}>{fmtPx(o.tp, d, true)}</td>
      <td className={`${td} text-[var(--muted)]`}>{fmtTime(o.time_setup)}</td>
      <td className={`${td} text-[var(--muted)]`}>{o.expiration ? fmtTime(o.expiration) : "GTC"}</td>
      <td className={td + " text-right"} onClick={(e) => e.stopPropagation()}>
        <button
          className="cursor-pointer rounded border border-[#f23645] px-2 py-0.5 text-[#f23645] hover:bg-[#f23645]/15 disabled:cursor-not-allowed disabled:opacity-40"
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
  const rows = closedPositions(data.deals);
  if (rows.length === 0) return <Empty>Chưa có vị thế nào đã đóng trong những ngày gần đây.</Empty>;
  const ccy = data.account.currency;
  const heads: [string, boolean?][] = [["Symbol"], ["Type"], ["Volume, lot", true], ["Open price", true], ["Close price", true], ["T/P", true], ["S/L", true], ["Position"], ["Open time"], ["Close time"], [`Swap, ${ccy}`, true], ["Reason"], [`P/L, ${ccy}`, true]];
  return (
    <table className="w-full text-xs tabular-nums">
      <Head cols={heads} />
      <tbody>
        {rows.map((r) => {
          const d = digitsOf(r.symbol);
          return (
            <tr key={r.position} className={rowClass}>
              <td className={td}><SymbolCell symbol={r.symbol} /></td>
              <td className={td}><SideCell side={r.side} /></td>
              <td className={td + R}>{fmtLot(r.volume)}</td>
              <td className={td + R}>{r.openTime ? fmtPx(r.open, d) : "—"}</td>
              <td className={td + R}>{fmtPx(r.close, d)}</td>
              <td className={td + R}>{fmtPx(r.tp, d, true)}</td>
              <td className={td + R}>{fmtPx(r.sl, d, true)}</td>
              <td className={td}>{r.position > 0 ? r.position : "—"}</td>
              <td className={td}>{fmtTime(r.openTime)}</td>
              <td className={td}>{fmtTime(r.closeTime)}</td>
              <td className={td + R}>{r.swap.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
              <td className={td}>{REASON_LABEL[r.reason] ?? "—"}</td>
              <td className={`${td}${R} font-medium ${pnlClass(r.pnl)}`}>{fmtPnl(r.pnl)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
