"use client";

import { openCreateAlert } from "@/alerts/store";
import { useDrawingStore } from "@/drawings/store";
import { tfShort } from "@/lib/timeframes";
import { toggleReplay, useReplayStore } from "@/replay/store";
import { useChartStore } from "@/store/chart";
import { startedOn } from "@/lib/layoutMode";
import { useLayoutStore } from "@/store/layout";
import { useRailStore, type RailPanel } from "@/store/rail";
import { useSettingsStore } from "@/store/settings";
import { useOrderState } from "@/trading/actions";
import { draftLines } from "@/trading/draft";
import { cancelOwnerEdits, confirmOwnerEdits, pendingFor, useEditBridge } from "@/trading/editBridge";
import { COLORS, fmtLot, orderLabel, sideColor, sideLabel } from "@/trading/format";
import { useTradeStore } from "@/trading/store";
import { quoteOf, useQuoteStore } from "@/trading/quote";
import { seedDraftStop, submitDraft } from "@/trading/submit";
import { ticketBusy, useTicketStore } from "@/trading/ticket";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AddOrderI,
  AlertI,
  CalendarI,
  CameraI,
  Candles,
  Close,
  DotsI,
  FullscreenI,
  IndicatorsI,
  MoonI,
  Redo,
  Replay,
  SettingsI,
  SunI,
  TradingI,
  Undo,
  WatchlistI,
} from "../icons";
import AccountMenu from "./AccountMenu";
import AlertsPanel from "./AlertsPanel";
import EconomicCalendarPanel from "./EconomicCalendarPanel";
import IndicatorsDialog from "./IndicatorsDialog";
import LayoutBar from "./LayoutBar";
import LayoutMenu from "./LayoutMenu";
import OrderTicket from "./OrderTicket";
import TimeframeBar from "./TimeframeBar";
import { CHART_TYPES, SymbolSearch, toggleFullscreen, useSymbolsPolling } from "./Toolbar";
import TradingPanel, { useTradePolling } from "./TradingPanel";
import WatchlistPanel from "./WatchlistPanel";

// Khung của phone (docs/mobile-responsive-plan.md M1): thanh trên gọn + menu ⋯, tab bar ở đáy thay thanh bên phải và panel Trading,
// các panel mở phủ lên vùng chart (chart vẫn mount bên dưới, giữ WebSocket và góc nhìn). Nút cao 40px cho dễ chạm.
const btn = "flex h-10 items-center rounded px-2 text-sm hover:bg-[var(--hover)]";
const iconBtn = "flex h-10 w-10 shrink-0 items-center justify-center rounded hover:bg-[var(--hover)] disabled:opacity-55";
const item = "flex h-11 w-full items-center gap-3 px-3 text-left text-sm hover:bg-[var(--hover)]";

/** Popup thả xuống từ một nút trên thanh trên, canh mép phải nút. */
function Popover({ trigger, open, setOpen, className, children }: {
  trigger: ReactNode;
  open: boolean;
  setOpen: (v: boolean) => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      {trigger}
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className={`absolute right-0 top-11 z-40 rounded-lg popup py-1 ${className}`}>{children}</div>
        </>
      )}
    </div>
  );
}

/** Layout nhiều chart: phone chỉ hiện chart active, nút này chọn chart khác (đổi chart active, không đổi layout). */
function PaneSwitcher() {
  const order = useLayoutStore((s) => s.order);
  const panes = useLayoutStore((s) => s.panes);
  const activeId = useLayoutStore((s) => s.activeId);
  const [open, setOpen] = useState(false);
  if (order.length < 2) return null;
  const idx = order.indexOf(activeId);
  return (
    <Popover
      open={open}
      setOpen={setOpen}
      className="min-w-[200px]"
      trigger={
        <button className={`${btn} font-semibold tabular-nums ${open ? "bg-[var(--hover)]" : ""}`} title="Chọn chart" aria-label="Chọn chart" aria-expanded={open} onClick={() => setOpen(!open)}>
          {idx + 1}/{order.length}
        </button>
      }
    >
      {order.map((id, i) => {
        const c = panes[id]?.chart.getState();
        return (
          <button
            key={id}
            className={`${item} ${id === activeId ? "bg-[var(--hover)] font-semibold" : ""}`}
            onClick={() => {
              useLayoutStore.getState().setActive(id);
              setOpen(false);
            }}
          >
            <span className="w-4 text-[var(--muted)] tabular-nums">{i + 1}</span>
            {c ? `${c.symbol} · ${tfShort(c.tf)}` : id}
          </button>
        );
      })}
    </Popover>
  );
}

/** Menu ⋯: các nút của toolbar desktop không còn chỗ trên phone. */
function MoreMenu() {
  const [open, setOpen] = useState(false);
  const chartType = useChartStore((s) => s.chartType);
  const theme = useChartStore((s) => s.theme);
  const set = useChartStore((s) => s.set);
  const api = useDrawingStore((s) => s.api);
  const replayOn = useReplayStore((s) => s.active || s.selecting);
  const run = (f: () => void) => () => {
    setOpen(false);
    f();
  };
  // iPhone Safari không cho trang web vào fullscreen: không có thì ẩn nút
  const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled;

  return (
    <Popover
      open={open}
      setOpen={setOpen}
      className="w-[min(300px,calc(100vw-16px))]"
      trigger={
        <button className={`${iconBtn} ${open ? "bg-[var(--hover)]" : ""}`} title="More" aria-label="More" aria-expanded={open} onClick={() => setOpen(!open)}>
          <DotsI />
        </button>
      }
    >
      {/* popup của LayoutMenu / LayoutBar canh mép phải nút của chúng: để chúng sát mép phải cho khỏi tràn trái màn hình */}
      <div className="flex items-center gap-1 border-b border-[var(--border)] pb-1 pl-3 pr-1">
        <span className="mr-auto text-xs text-[var(--muted)]">Layout</span>
        <LayoutBar />
        <LayoutMenu className={iconBtn} />
      </div>
      <div className="flex items-center gap-1 border-b border-[var(--border)] px-1 py-1" role="group" aria-label="Chart type">
        {CHART_TYPES.map((c) => (
          <button
            key={c.v}
            className={`${iconBtn} ${c.v === chartType ? "bg-[var(--hover)] text-[var(--accent-text)]" : ""}`}
            title={c.label}
            aria-label={c.label}
            aria-pressed={c.v === chartType}
            onClick={run(() => set({ chartType: c.v }))}
          >
            {c.icon}
          </button>
        ))}
      </div>
      <button className={item} onClick={run(() => void openCreateAlert())}>
        <AlertI /> Create alert
      </button>
      <button className={`${item} ${replayOn ? "text-[var(--accent-text)]" : ""}`} onClick={run(toggleReplay)}>
        <Replay /> Replay
      </button>
      {/* Undo / Redo không đóng menu: hay bấm nhiều lần liền */}
      <div className="flex items-center gap-1 border-y border-[var(--border)] px-1 py-1">
        <button className={iconBtn} title="Undo" aria-label="Undo" onClick={() => api?.undo()}>
          <Undo />
        </button>
        <button className={iconBtn} title="Redo" aria-label="Redo" onClick={() => api?.redo()}>
          <Redo />
        </button>
      </div>
      <button className={item} onClick={run(() => useSettingsStore.setState({ open: true }))}>
        <SettingsI /> Settings
      </button>
      <button className={item} onClick={run(() => window.dispatchEvent(new Event("tv-screenshot")))}>
        <CameraI /> Take a snapshot
      </button>
      <button className={item} onClick={run(() => set({ theme: theme === "dark" ? "light" : "dark" }))}>
        {theme === "dark" ? <SunI /> : <MoonI />} {theme === "dark" ? "Light theme" : "Dark theme"}
      </button>
      {canFullscreen && (
        <button className={item} onClick={run(() => void toggleFullscreen())}>
          <FullscreenI /> Fullscreen
        </button>
      )}
    </Popover>
  );
}

export function MobileTopBar() {
  useSymbolsPolling();
  // z-50: popup của thanh này thả xuống đè lên panel phủ chart (z-[45]) bên dưới
  return (
    <div className="relative z-50 flex h-11 shrink-0 items-center gap-0.5 border-b border-[var(--border)] bg-[var(--page)] px-1">
      <div className="flex w-10 shrink-0 items-center justify-center">
        <AccountMenu />
      </div>
      <SymbolSearch />
      <TimeframeBar className={btn} compact />
      <IndicatorsDialog className={iconBtn} icon={<IndicatorsI />} iconOnly />
      <div className="flex-1" />
      <PaneSwitcher />
      <MoreMenu />
    </div>
  );
}

const TABS: { id: RailPanel | null; label: string; icon: ReactNode }[] = [
  { id: null, label: "Chart", icon: <Candles /> },
  { id: "watchlist", label: "Watchlist", icon: <WatchlistI /> },
  { id: "alerts", label: "Alerts", icon: <AlertI /> },
  { id: "calendar", label: "Calendar", icon: <CalendarI /> },
  { id: "order", label: "Order", icon: <AddOrderI /> }, // chỉ hiện khi đang soạn lệnh (như thanh bên phải)
  { id: "trading", label: "Trading", icon: <TradingI /> },
];

/** Tab bar ở đáy: Chart = không panel nào mở; các tab khác mở panel tương ứng phủ lên chart. */
export function MobileTabBar() {
  useTradePolling(); // panel Trading chỉ mount khi mở tab: hỏi dữ liệu lệnh ở đây cho thẻ lệnh / đường SL-TP trên chart
  const open = useRailStore((s) => s.open);
  const setOpen = useRailStore((s) => s.setOpen);
  const drafting = useTicketStore(ticketBusy);
  const symbol = useChartStore((s) => s.symbol);
  const lastSymbol = useRef(symbol);

  // Chọn một symbol trong Watchlist thì về chart luôn (như app TradingView trên điện thoại)
  useEffect(() => {
    if (symbol === lastSymbol.current) return;
    lastSymbol.current = symbol;
    if (useRailStore.getState().open === "watchlist") setOpen(null);
  }, [symbol, setOpen]);

  const tabs = TABS.filter((t) => t.id !== "order" || drafting);
  return (
    <nav className="flex h-14 shrink-0 border-t border-[var(--border)] bg-[var(--page)]" aria-label="Panels">
      {tabs.map((t) => {
        const on = open === t.id || (t.id === null && open === "order" && !drafting);
        return (
          <button
            key={t.label}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${on ? "text-[var(--accent-text)]" : "text-[var(--muted)]"}`}
            aria-current={on ? "page" : undefined}
            onClick={() => setOpen(t.id)}
          >
            {t.icon}
            <span className="truncate">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Bảng đặt lệnh trên phone, kiểu MT5: sheet nổi đè lên phần dưới chart (chart giữ nguyên cỡ, không bị đẩy). Thanh nắm trên cùng: chạm / vuốt xuống
 *  thu gọn thành một dòng (symbol, lệnh, nút SL / TP, nút đặt) để thấy và kéo đường entry / SL / TP trên chart; vuốt lên / chạm lại mở ra.
 *  Thu gọn chỉ ẩn bảng (vẫn mount): không mất gì đang soạn. */
export function MobileOrderSheet() {
  const open = useRailStore((s) => s.open);
  const drafting = useTicketStore(ticketBusy);
  const id = useTicketStore((s) => s.id);
  const collapsed = useRailStore((s) => s.sheetCollapsedFor === id); // bảng mới (id khác) thì tự mở rộng
  const setCollapsed = (v: boolean) => useRailStore.setState({ sheetCollapsedFor: v ? id : null });
  const startY = useRef<number | null>(null);
  if (open !== "order" || !drafting) return null;
  return (
    <div className={`absolute inset-x-0 bottom-0 z-[45] flex flex-col rounded-t-xl border-t border-[var(--border)] bg-[var(--bg)] shadow-[0_-6px_20px_rgba(0,0,0,0.45)] ${collapsed ? "" : "max-h-[60%]"}`}>
      <button
        type="button"
        aria-label={collapsed ? "Mở rộng bảng đặt lệnh" : "Thu gọn bảng đặt lệnh"}
        aria-expanded={!collapsed}
        className="flex h-7 w-full shrink-0 touch-none items-center justify-center"
        onPointerDown={(e) => (startY.current = e.clientY)}
        onPointerUp={(e) => {
          const dy = startY.current === null ? 0 : e.clientY - startY.current;
          startY.current = null;
          setCollapsed(dy > 24 ? true : dy < -24 ? false : !collapsed); // vuốt xuống thu, vuốt lên mở, chạm thì đảo
        }}
      >
        <span className="h-1 w-10 rounded-full bg-[var(--muted)] opacity-60" />
      </button>
      {collapsed && <CollapsedTicket onExpand={() => setCollapsed(false)} />}
      <div className={collapsed ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <OrderTicket />
      </div>
    </div>
  );
}

const roundBtn = "flex h-10 w-12 shrink-0 items-center justify-center rounded-lg disabled:opacity-55";
const Arrow = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/** Dòng của bảng đặt lệnh khi thu gọn (như MT5). Bản nháp: "XAUUSDm  BUY LIMIT 0.01   (SL) (TP) →" — SL / TP bật tắt mức dừng (mức gợi ý như công tắc trong bảng),
 *  → gửi lệnh qua cùng đường với nút đặt lệnh của bảng (kiểm tra bản nháp, báo lỗi bằng toast). Lệnh đã đặt: tên lệnh, và khi có thay đổi vừa kéo trên chart thì ✕ (Discard) / ✓ (Confirm). */
function CollapsedTicket({ onExpand }: { onExpand: () => void }) {
  const d = useTicketStore((s) => s.draft);
  const owner = useTicketStore((s) => s.modifyOwner);
  const replay = useReplayStore((s) => s.active);
  const quote = useQuoteStore((s) => (d ? quoteOf(s, d.symbol, replay) : undefined));
  const busy = useOrderState((s) => s.busy);
  const data = useTradeStore((s) => s.data);
  const byPane = useEditBridge((s) => s.byPane);
  const head = (symbol: string, sub: string, color: string) => (
    <button type="button" className="min-w-0 flex-1 text-left" onClick={onExpand}>
      <div className="truncate text-[15px] font-semibold">{symbol}</div>
      <div className="truncate text-xs" style={{ color }}>{sub}</div>
    </button>
  );
  if (!d) {
    const [kind, tk] = (owner ?? "").split(":");
    const pos = kind === "position" ? data?.positions.find((p) => p.ticket === Number(tk)) : undefined;
    const ord = kind === "order" ? data?.orders.find((o) => o.ticket === Number(tk)) : undefined;
    const item = pos ?? ord;
    if (!owner || !item) {
      return (
        <button type="button" className="flex h-12 items-center px-4 text-left text-sm text-[var(--muted)]" onClick={onExpand}>
          Chạm để mở bảng lệnh
        </button>
      );
    }
    const sub = `${pos ? sideLabel(pos.type) : orderLabel(ord!.type)} ${fmtLot(item.volume)} #${item.ticket}`.toUpperCase();
    const pending = pendingFor(byPane, owner).length > 0;
    return (
      <div className="flex h-14 items-center gap-2 px-3 pb-1">
        {head(item.symbol, pending ? `${sub} · chờ xác nhận` : sub, sideColor((pos ? pos.type : ord!.type).startsWith("buy") ? "buy" : "sell"))}
        {pending && (
          <>
            <button type="button" aria-label="Discard" className={`${roundBtn} border border-[var(--border)]`} onClick={(e) => startedOn(e) && cancelOwnerEdits(owner)}>
              <Close size={22} />
            </button>
            <button type="button" aria-label="Confirm" disabled={busy} className={`${roundBtn} bg-[var(--accent)] text-white`} onClick={(e) => startedOn(e) && confirmOwnerEdits(owner)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </button>
          </>
        )}
      </div>
    );
  }
  // Market: "BUY 0.01" như chữ trên đường (không phải "MARKET 0.01")
  const title = d.mode === "market" ? `${d.side} ${d.lot}`.toUpperCase() : (draftLines(d, d.symbol, quote).find((l) => l.key === "d:entry")?.title ?? `${d.side} ${d.lot}`.toUpperCase());
  const stop = (kind: "sl" | "tp") => {
    const on = d[kind] !== "";
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-label={kind === "sl" ? "Stop loss" : "Take profit"}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold"
        style={{ borderColor: COLORS[kind], color: on ? "#fff" : COLORS[kind], background: on ? COLORS[kind] : "transparent" }}
        onClick={() => (on ? useTicketStore.getState().patch({ [kind]: "" }) : seedDraftStop(kind))}
      >
        {kind.toUpperCase()}
      </button>
    );
  };
  return (
    <div className="flex h-14 items-center gap-2 px-3 pb-1">
      {head(d.symbol, title, sideColor(d.side))}
      {stop("sl")}
      {stop("tp")}
      <button type="button" aria-label="Đặt lệnh" disabled={busy} className={`${roundBtn} text-white`} style={{ background: sideColor(d.side) }} onClick={(e) => startedOn(e) && void submitDraft()}>
        <Arrow />
      </button>
    </div>
  );
}

/** Panel đang mở (theo tab bar) phủ lên vùng chart. Cùng nội dung với thanh bên phải của desktop, cộng panel Trading. */
export function MobilePanel() {
  const open = useRailStore((s) => s.open);
  const setOpen = useRailStore((s) => s.setOpen);
  if (!open || open === "order") return null; // bảng đặt lệnh: MobileOrderSheet
  return (
    <div className="absolute inset-0 z-[45] flex flex-col bg-[var(--bg)]">
      {open === "calendar" && (
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
          <span className="text-[18px] font-semibold leading-6">Economic calendar</span>
          <button className="rounded p-1 hover:bg-[var(--hover)]" onClick={() => setOpen(null)} aria-label="Close">
            <Close />
          </button>
        </div>
      )}
      <div className={`min-h-0 flex-1 ${open === "trading" ? "" : "overflow-y-auto"}`}>
        {open === "watchlist" ? (
          <WatchlistPanel />
        ) : open === "alerts" ? (
          <AlertsPanel />
        ) : open === "calendar" ? (
          <EconomicCalendarPanel />
        ) : (
          <TradingPanel fill />
        )}
      </div>
    </div>
  );
}
