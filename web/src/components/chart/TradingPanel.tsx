"use client";

import { fmtMoney } from "@/lib/mt5Format";
import ModeBadge from "./ModeBadge";
import type { PendingOrder, Position, TradeData } from "@/lib/mt5Api";
import { useAuthStore } from "@/store/auth";
import { askConfirm } from "@/store/confirm";
import { useChartStore } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { cancelOrder, useOrderState } from "@/trading/actions";
import { askCancelAll, askCancelOrder, askCloseAll, askClosePosition } from "@/trading/tagActions";
import { accountProfit, closedPositions, fmtLot, fmtPnl, fmtPx, fmtTime, isStale, orderLabel, pnlClass, positionPnl, realizedSince, REASON_LABEL, sideLabel } from "@/trading/format";
import { useTradeFocus } from "@/trading/focus";
import { tradeBlock } from "@/trading/gate";
import { closeLot } from "@/trading/lot";
import { resetSim } from "@/trading/simStore";
import { startTradePolling, useTradeStore, type TradeTab } from "@/trading/store";
import { useTicketStore } from "@/trading/ticket";
import { useEffect, useState, type ReactNode } from "react";
import EmptyState from "../EmptyState";
import { EmptyHistoryI, EmptyOrdersI, EmptyPositionsI } from "../icons";
import { SymbolBadge } from "../SymbolIcon";
import LotSlider from "./LotSlider";

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
// Buy xanh lá, Sell đỏ (màu lên / xuống của chart) ở cả 3 bảng
const SIDE_COLOR = { buy: "#089981", sell: "#f23645" };
const SideCell = ({ side, label = sideLabel(side) }: { side: "buy" | "sell"; label?: string }) => (
  <span className="flex items-center gap-1.5 font-medium" style={{ color: SIDE_COLOR[side] }}>
    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: SIDE_COLOR[side] }} />
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
                className="cursor-pointer rounded border border-[#f23645] px-2 py-0.5 text-[#f23645] hover:bg-[#f23645]/15 disabled:cursor-not-allowed disabled:opacity-55"
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

/** Hỏi backend vị thế / lệnh / account của account MT5 đang chọn (đăng xuất hay chưa có account thì xoá). Panel Trading dưới chart gọi trên desktop;
 *  trên phone panel chỉ mount khi mở tab Trading nên tab bar đáy gọi thay, để thẻ lệnh và đường SL/TP trên chart vẫn có dữ liệu. */
export function useTradePolling(enabled = true) {
  const status = useAuthStore((s) => s.status);
  const activeId = useMt5Store((s) => s.accounts.find((a) => a.active)?.id);
  useEffect(() => {
    if (!enabled) return;
    if (status === "user" && activeId) return startTradePolling();
    useTradeStore.getState().clear();
  }, [enabled, status, activeId]);
}

/** Panel Trading dưới chart (docs/trade-plan.md T1-T2): vị thế, lệnh chờ, lịch sử, tóm tắt account MT5 đang cấp dữ liệu. Chỉ hiện khi đã đăng nhập
 *  và có account MT5 kết nối. Đóng / đóng một phần vị thế ở tab Positions (chỉ account demo); lệnh chờ và sửa SL/TP chưa có (T3-T4).
 *  Đang Replay: panel là của account giả lập (trading/simStore.ts, nhãn REPLAY, khách cũng thấy), có nút Reset để làm lại sổ lệnh từ số dư MT5.
 *  `fill` (tab Trading trên phone): chiếm hết panel, không có nút thu gọn, tóm tắt account xuống dòng; chưa có dữ liệu thì hiện lời nhắc thay vì ẩn. */
export default function TradingPanel({ fill = false }: { fill?: boolean }) {
  const status = useAuthStore((s) => s.status);
  const loaded = useMt5Store((s) => s.loaded);
  const activeId = useMt5Store((s) => s.accounts.find((a) => a.active)?.id);
  const data = useTradeStore((s) => s.data);
  const sim = useTradeStore((s) => s.sim);
  const open = useTradeStore((s) => s.open);
  const tab = useTradeStore((s) => s.tab);
  const now = useNowSec();
  useTradePolling(!fill); // phone: tab bar đáy hỏi thay (panel này chỉ mount khi mở tab)

  if (!data || (!sim && (status !== "user" || !loaded || !activeId))) {
    if (!fill) return null;
    return (
      <EmptyState icon={<EmptyPositionsI size={40} />} className="h-full">
        {status !== "user" ? "Đăng nhập và kết nối tài khoản MT5 để xem vị thế, lệnh chờ và lịch sử." : loaded && !activeId ? "Chưa có tài khoản MT5 nào đang kết nối." : "Đang tải…"}
      </EmptyState>
    );
  }
  const stale = isStale(data, now);
  const a = data.account;
  const pnl = accountProfit(data);
  const realized = realizedSince(data.deals, new Date(now * 1000).setHours(0, 0, 0, 0) / 1000); // hôm nay, theo giờ máy
  const ccy = a.currency;
  // Unrealized P/L và Margin level chỉ có nghĩa khi đang có lệnh (MT5 báo margin level 0 khi chưa dùng margin)
  const stats: [string, string, string?][] = [
    ["Equity", fmtMoney(a.equity, ccy)],
    ["Free Margin", fmtMoney(a.margin_free, ccy)],
    ["Margin", fmtMoney(a.margin, ccy)],
    ["Balance", fmtMoney(a.balance, ccy)],
    ...(data.positions.length > 0 ? ([["Unrealized P/L", fmtPnl(pnl), pnlClass(pnl)]] as [string, string, string?][]) : []),
    ["Realized P/L", fmtPnl(realized), pnlClass(realized)],
    ...(a.margin_level ? ([["Margin level", `${a.margin_level.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`]] as [string, string, string?][]) : []),
  ];

  const account = (
    <span className="flex min-w-0 items-center gap-2 px-1.5">
      <span className="max-w-[160px] truncate text-[13px]" title={a.server || undefined}>{a.name || a.broker || a.server}</span>
      <ModeBadge mode={a.mode} />
      {sim && (
        <button
          className="inline-flex h-[18px] cursor-pointer items-center rounded border border-[var(--border)] px-1.5 text-[10px] leading-none text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
          title="Làm lại account giả lập từ số dư MT5: xoá vị thế, lệnh chờ và lịch sử của Replay"
          onClick={() =>
            askConfirm({
              title: "Reset account Replay",
              message: "Xoá vị thế, lệnh chờ và lịch sử giả lập; số dư về lại số dư account MT5.",
              confirmLabel: "Reset",
              danger: true,
              onConfirm: resetSim,
            })
          }
        >
          Reset
        </button>
      )}
      {stale && <span className="inline-flex h-[18px] items-center rounded border border-[var(--border)] bg-[var(--hover)] px-1.5 text-[10px] leading-none text-[var(--muted)]">{a.online ? "dữ liệu cũ" : "offline"}</span>}
    </span>
  );
  const tabs = (
    <div className="flex items-center gap-1.5">
      {TABS.map((t) => {
        const n = t.id === "positions" ? data.positions.length : t.id === "orders" ? data.orders.length : null;
        const on = (fill || open) && tab === t.id;
        return (
          <button
            key={t.id}
            className={`cursor-pointer rounded px-3 py-1 text-[13px] hover:bg-[var(--hover)] ${on ? "bg-[var(--hover)] font-semibold" : "text-[var(--muted)]"}`}
            onClick={() => useTradeStore.getState().showTab(t.id)}
          >
            {t.label}
            {n ? <span className="ml-1 text-xs">({n})</span> : null}
          </button>
        );
      })}
    </div>
  );
  const summary = (className: string) => (
    <div className={`${className} text-xs tabular-nums ${stale ? "opacity-60" : ""}`} data-testid="account-summary">
      {stats.map(([k, v, cls]) => (
        <span key={k} className="whitespace-nowrap text-[var(--muted)]">
          {k} <span className={cls ?? "text-[var(--fg)]"}>{v}</span>
        </span>
      ))}
    </div>
  );
  const body = (
    <>
      {tab === "positions" && <Positions data={data} cards={fill} />}
      {tab === "orders" && <Orders data={data} cards={fill} />}
      {tab === "history" && <History data={data} cards={fill} />}
    </>
  );

  if (fill) {
    return (
      <div className="flex h-full flex-col bg-[var(--bg)]" data-testid="trading-panel">
        <div className="flex items-center gap-1 px-2 pt-2 text-sm">
          <span className="px-1.5 font-semibold">Trading</span>
          {account}
        </div>
        {summary("flex flex-wrap gap-x-4 gap-y-1 px-3.5 py-2")}
        <div className="border-b border-[var(--border)] px-2 pb-2">{tabs}</div>
        <div className={`min-h-0 flex-1 overflow-auto ${stale ? "opacity-60" : ""}`}>{body}</div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg)]" data-testid="trading-panel">
      <div className="flex h-[34px] items-center gap-1 pl-2 text-sm">
        <span className="px-1.5 font-semibold">Trading</span>
        <span className="mx-1 h-4 w-px bg-[var(--border)]" aria-hidden />
        {account}
        <span className="mx-1 h-4 w-px bg-[var(--border)]" aria-hidden />
        {tabs}
        {summary("ml-auto flex min-w-0 items-center gap-4 overflow-hidden pr-3")}
        {/* Ô cùng bề rộng (w-12) và đường kẻ dọc với thanh icon bên phải chart: nút nằm thẳng cột với các icon trên và đường kẻ nối liền xuống */}
        <div className="flex h-full w-12 shrink-0 items-center justify-center border-l border-[var(--border)]">
          <button
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--fg)_22%,transparent)] bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] text-[var(--fg)] hover:border-[color-mix(in_srgb,var(--fg)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--fg)_16%,transparent)]"
            title={open ? "Collapse panel" : "Expand panel"}
            aria-label={open ? "Collapse trading panel" : "Expand trading panel"}
            aria-expanded={open}
            onClick={() => useTradeStore.getState().setOpen(!open)}
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? "rotate-180" : ""}`}>
              <path d="M3.5 10l4.5-4.5L12.5 10" />
            </svg>
          </button>
        </div>
      </div>
      {/* mở / thu có chuyển động (user 10-29): hàng lưới 0fr ↔ 1fr trượt chiều cao, chart bên trên co giãn theo; thu xong vẫn giữ nội dung (ẩn) */}
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`} aria-hidden={!open}>
        <div className="min-h-0 overflow-hidden">
          <div className={`h-[180px] overflow-auto border-t border-[var(--border)] ${stale ? "opacity-60" : ""}`} inert={!open}>
            {body}
          </div>
        </div>
      </div>
    </div>
  );
}

const digitsOf = (symbol: string) => useChartStore.getState().symbols.find((s) => s.name === symbol)?.digits;
const rowClass = "border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--hover)]";
const rowSelected = "border-b border-[var(--border)] bg-[var(--selected)] last:border-b-0";

/** Bấm một dòng vị thế / lệnh chờ = chọn lệnh đó như bấm thẻ của nó trên chart (mở bảng Modify, các lệnh khác mờ đi): chọn được cả khi hai lệnh sát nhau tới mức không bấm trúng thẻ.
 *  Lệnh của symbol khác với chart đang xem thì chuyển chart sang symbol đó trước, vì đường SL / TP chỉ sửa được trên chart có đường của lệnh. */
function useSelectTrade(owner: string, symbol: string) {
  const selected = useTradeFocus((s) => s.owner === owner);
  return {
    selected,
    select: () => {
      if (useChartStore.getState().symbol !== symbol) useChartStore.getState().set({ symbol });
      if (!selected || useTicketStore.getState().modifyOwner !== owner) useTicketStore.getState().select(owner);
    },
  };
}
const Empty = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
  <EmptyState icon={icon} className="h-full">
    {children}
  </EmptyState>
);

function Positions({ data, cards }: { data: TradeData; cards?: boolean }) {
  const busy = useOrderState((s) => s.busy);
  if (data.positions.length === 0) return <Empty icon={<EmptyPositionsI />}>Không có vị thế đang mở.</Empty>;
  const block = tradeBlock({ status: "user", loaded: true, account: data.account, spec: { min: 0, max: 0, step: 0 }, hasQuote: true });
  const all = { label: "Close all", disabled: block !== null || busy, title: block ?? "Đóng tất cả vị thế", run: () => askCloseAll(data.positions) };
  if (cards) {
    return (
      <div>
        <CardsHead text={`${data.positions.length} vị thế`} all={all} />
        {data.positions.map((p) => (
          <PositionCard key={p.ticket} p={p} account={data.account} />
        ))}
      </div>
    );
  }
  return (
    <table className="w-full text-xs tabular-nums">
      <Head cols={[["Symbol"], ["Side"], ["Lot", true], ["Entry", true], ["SL", true], ["TP", true], ["Price", true], ["P/L", true], ["Opened"], [""]]} all={all} />
      <tbody>
        {data.positions.map((p) => (
          <PositionRow key={p.ticket} p={p} account={data.account} />
        ))}
      </tbody>
    </table>
  );
}

// Nút Close của một vị thế (hàng bảng và thẻ dùng chung): bấm mở ô lot (mặc định cả vị thế), sửa nhỏ hơn rồi OK = đóng một phần; OK mở hộp thoại xác nhận (cùng hộp với dấu × trên chart).
function usePositionClose(p: Position, account: TradeData["account"]) {
  const busy = useOrderState((s) => s.busy);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  // vào được lệnh đóng khi account sẵn sàng; spec/giá chỉ cần cho widget SELL/BUY
  const block = tradeBlock({ status: "user", loaded: true, account, spec: { min: 0, max: 0, step: 0 }, hasQuote: true });
  const sym = useChartStore.getState().symbols.find((s) => s.name === p.symbol);
  const spec = sym?.volume_min && sym.volume_step ? { min: sym.volume_min, max: p.volume, step: sym.volume_step } : null;
  const canPartial = spec !== null && p.volume > spec.min + 1e-9; // lot lớn hơn lot tối thiểu thì mới đóng một phần được
  const want0 = closeLot(text, p.volume, spec); // null = ô lot không phải số dương
  const close = () => {
    const want = want0;
    if (want === null) return; // gõ sai: không đóng gì (trước đây thành lot tối thiểu), giữ ô nhập để sửa
    setEditing(false);
    askClosePosition(p, want >= p.volume - 1e-9 ? 0 : want); // hộp thoại xác nhận rồi mới gửi; 0 = đóng hết
  };
  const start = () => {
    if (!canPartial) return askClosePosition(p); // không chia nhỏ được: đóng hết (có hộp xác nhận)
    setText(fmtLot(p.volume));
    setEditing(true);
  };
  const title = block ?? (canPartial ? "Đóng vị thế (kéo thanh hoặc sửa lot để đóng một phần)" : "Đóng vị thế");
  return { disabled: block !== null || busy, title, spec, editing, setEditing, text, setText, want0, close, start };
}

const closeBtn = "cursor-pointer rounded border border-[#f23645] px-2 py-0.5 text-[#f23645] hover:bg-[#f23645]/15 disabled:cursor-not-allowed disabled:opacity-55";

function CloseLotEditor({ c, className }: { c: ReturnType<typeof usePositionClose>; className: string }) {
  return (
    <span className={className}>
      {c.spec && <LotSlider spec={c.spec} value={c.want0 ?? c.spec.max} onChange={(lot) => c.setText(fmtLot(lot))} />}
      <input
        autoFocus
        aria-label="Close lot"
        inputMode="decimal"
        value={c.text}
        onChange={(e) => c.setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") c.close();
          else if (e.key === "Escape") c.setEditing(false);
        }}
        className="w-16 rounded border border-[var(--border)] bg-transparent px-1.5 py-1 text-center"
      />
      <button className="cursor-pointer rounded bg-[#f23645] px-3 py-1 text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55" disabled={c.want0 === null} onClick={c.close}>OK</button>
      <button className="cursor-pointer px-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]" aria-label="Cancel" onClick={() => c.setEditing(false)}>✕</button>
    </span>
  );
}

function PositionRow({ p, account }: { p: Position; account: TradeData["account"] }) {
  const d = digitsOf(p.symbol);
  const pl = positionPnl(p);
  const c = usePositionClose(p, account);
  const { selected, select } = useSelectTrade(`position:${p.ticket}`, p.symbol);
  return (
    <tr className={`cursor-pointer ${selected ? rowSelected : rowClass}`} onClick={select} data-testid="position-row">
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
        <button className={`${closeBtn} ${c.editing ? "invisible" : ""}`} disabled={c.disabled} title={c.title} onClick={c.start}>
          Close
        </button>
        {c.editing && (
          // nổi lên trên hàng (không đẩy các cột khác), cao đúng bằng hàng, neo bên phải
          <CloseLotEditor c={c} className="absolute inset-y-0 right-0 z-10 flex items-center justify-center gap-3 border-l border-[var(--border)] bg-[var(--bg)] px-3 shadow-lg" />
        )}
      </td>
    </tr>
  );
}

// ---- Thẻ (tab Trading trên phone): bảng nhiều cột phải cuộn ngang và nút Close nằm ngoài màn, thẻ gói đủ thông tin + nút trong bề rộng điện thoại ----
const card = "border-b border-[var(--border)] px-3.5 py-3 text-[13px] tabular-nums";
const cardBtn = "h-9 cursor-pointer rounded border border-[#f23645] px-4 text-[13px] text-[#f23645] hover:bg-[#f23645]/15 disabled:cursor-not-allowed disabled:opacity-55";
const Kv = ({ k, v, cls }: { k: string; v: ReactNode; cls?: string }) => (
  <span className="whitespace-nowrap text-[var(--muted)]">
    {k} <span className={cls ?? "text-[var(--fg)]"}>{v}</span>
  </span>
);

function CardsHead({ text, all }: { text: string; all: { label: string; disabled?: boolean; title?: string; run: () => void } }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] px-3.5 py-2 text-[13px] text-[var(--muted)]">
      {text}
      <button className={cardBtn} disabled={all.disabled} title={all.title} onClick={all.run}>
        {all.label}
      </button>
    </div>
  );
}

function PositionCard({ p, account }: { p: Position; account: TradeData["account"] }) {
  const d = digitsOf(p.symbol);
  const pl = positionPnl(p);
  const c = usePositionClose(p, account);
  const { selected, select } = useSelectTrade(`position:${p.ticket}`, p.symbol);
  return (
    <div className={`${card} cursor-pointer ${selected ? "bg-[var(--selected)]" : ""}`} onClick={select} data-testid="position-card">
      <div className="flex items-center gap-3">
        <SymbolCell symbol={p.symbol} />
        <SideCell side={p.type === "sell" ? "sell" : "buy"} />
        <span>{fmtLot(p.volume)}</span>
        <span className={`ml-auto text-[15px] font-semibold ${pnlClass(pl)}`}>{fmtPnl(pl)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <Kv k="Entry" v={fmtPx(p.price_open, d)} />
        <Kv k="Price" v={fmtPx(p.price_current, d)} />
        <Kv k="SL" v={fmtPx(p.sl, d, true)} />
        <Kv k="TP" v={fmtPx(p.tp, d, true)} />
        <Kv k="Opened" v={fmtTime(p.time)} cls="text-[var(--muted)]" />
      </div>
      <div className="mt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
        {c.editing ? (
          <CloseLotEditor c={c} className="flex items-center gap-3" />
        ) : (
          <button className={cardBtn} disabled={c.disabled} title={c.title} onClick={c.start}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}

function Orders({ data, cards }: { data: TradeData; cards?: boolean }) {
  const busy = useOrderState((s) => s.busy);
  if (data.orders.length === 0) return <Empty icon={<EmptyOrdersI />}>Không có lệnh chờ.</Empty>;
  const block = tradeBlock({ status: "user", loaded: true, account: data.account, spec: { min: 0, max: 0, step: 0 }, hasQuote: true });
  const all = { label: "Cancel all", disabled: block !== null || busy, title: block ?? "Huỷ tất cả lệnh chờ", run: () => askCancelAll(data.orders) };
  if (cards) {
    return (
      <div>
        <CardsHead text={`${data.orders.length} lệnh chờ`} all={all} />
        {data.orders.map((o) => (
          <OrderCard key={o.ticket} o={o} account={data.account} />
        ))}
      </div>
    );
  }
  return (
    <table className="w-full text-xs tabular-nums">
      <Head cols={[["Symbol"], ["Type"], ["Lot", true], ["Price", true], ["SL", true], ["TP", true], ["Placed"], ["Expires"], [""]]} all={all} />
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
  const block = tradeBlock({ status: "user", loaded: true, account, spec: { min: 0, max: 0, step: 0 }, hasQuote: true });
  const { selected, select } = useSelectTrade(`order:${o.ticket}`, o.symbol);
  return (
    <tr className={`cursor-pointer ${selected ? rowSelected : rowClass}`} onClick={select} data-testid="order-row">
      <td className={td}><SymbolCell symbol={o.symbol} /></td>
      <td className={td}><SideCell side={o.type.startsWith("buy") ? "buy" : "sell"} label={orderLabel(o.type)} /></td>
      <td className={td + R}>{fmtLot(o.volume)}</td>
      <td className={td + R}>{fmtPx(o.price_open, d)}</td>
      <td className={td + R}>{fmtPx(o.sl, d, true)}</td>
      <td className={td + R}>{fmtPx(o.tp, d, true)}</td>
      <td className={`${td} text-[var(--muted)]`}>{fmtTime(o.time_setup)}</td>
      <td className={`${td} text-[var(--muted)]`}>{o.expiration ? fmtTime(o.expiration) : "GTC"}</td>
      <td className={td + " text-right"} onClick={(e) => e.stopPropagation()}>
        <button className={closeBtn} disabled={block !== null || busy} title={block ?? "Huỷ lệnh chờ"} onClick={() => void cancelOrder(o.ticket, o.symbol)}>
          Cancel
        </button>
      </td>
    </tr>
  );
}

// Thẻ lệnh chờ: Cancel qua hộp xác nhận (phone luôn hỏi, xem oneClickOn), khác nút Cancel huỷ ngay của bảng desktop
function OrderCard({ o, account }: { o: PendingOrder; account: TradeData["account"] }) {
  const d = digitsOf(o.symbol);
  const busy = useOrderState((s) => s.busy);
  const block = tradeBlock({ status: "user", loaded: true, account, spec: { min: 0, max: 0, step: 0 }, hasQuote: true });
  const { selected, select } = useSelectTrade(`order:${o.ticket}`, o.symbol);
  return (
    <div className={`${card} cursor-pointer ${selected ? "bg-[var(--selected)]" : ""}`} onClick={select} data-testid="order-card">
      <div className="flex items-center gap-3">
        <SymbolCell symbol={o.symbol} />
        <SideCell side={o.type.startsWith("buy") ? "buy" : "sell"} label={orderLabel(o.type)} />
        <span>{fmtLot(o.volume)}</span>
        <span className="ml-auto font-semibold">{fmtPx(o.price_open, d)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <Kv k="SL" v={fmtPx(o.sl, d, true)} />
        <Kv k="TP" v={fmtPx(o.tp, d, true)} />
        <Kv k="Placed" v={fmtTime(o.time_setup)} cls="text-[var(--muted)]" />
        <Kv k="Expires" v={o.expiration ? fmtTime(o.expiration) : "GTC"} cls="text-[var(--muted)]" />
      </div>
      <div className="mt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
        <button className={cardBtn} disabled={block !== null || busy} title={block ?? "Huỷ lệnh chờ"} onClick={() => askCancelOrder(o)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function History({ data, cards }: { data: TradeData; cards?: boolean }) {
  if (data.deals.length === 0) return <Empty icon={<EmptyHistoryI />}>Chưa có giao dịch nào trong những ngày gần đây.</Empty>;
  const rows = closedPositions(data.deals);
  if (rows.length === 0) return <Empty icon={<EmptyHistoryI />}>Chưa có vị thế nào đã đóng trong những ngày gần đây.</Empty>;
  const ccy = data.account.currency;
  if (cards) {
    return (
      <div>
        {rows.map((r) => {
          const d = digitsOf(r.symbol);
          return (
            <div key={r.position} className={card} data-testid="history-card">
              <div className="flex items-center gap-3">
                <SymbolCell symbol={r.symbol} />
                <SideCell side={r.side} />
                <span>{fmtLot(r.volume)}</span>
                <span className={`ml-auto font-semibold ${pnlClass(r.pnl)}`}>{fmtPnl(r.pnl)}{ccy ? ` ${ccy}` : ""}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                <Kv k="Open" v={r.openTime ? fmtPx(r.open, d) : "—"} />
                <Kv k="Close" v={fmtPx(r.close, d)} />
                <Kv k="SL" v={fmtPx(r.sl, d, true)} />
                <Kv k="TP" v={fmtPx(r.tp, d, true)} />
                {r.swap !== 0 && <Kv k="Swap" v={r.swap.toLocaleString("en-US", { maximumFractionDigits: 2 })} />}
                <Kv k="Closed" v={fmtTime(r.closeTime)} cls="text-[var(--muted)]" />
                {REASON_LABEL[r.reason] && <span className="text-[var(--muted)]">{REASON_LABEL[r.reason]}</span>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
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
