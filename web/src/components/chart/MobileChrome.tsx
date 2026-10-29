"use client";

import { openCreateAlert } from "@/alerts/store";
import { useDrawingStore } from "@/drawings/store";
import { tfShort } from "@/lib/timeframes";
import { toggleReplay, useReplayStore } from "@/replay/store";
import { useChartStore } from "@/store/chart";
import { useLayoutStore } from "@/store/layout";
import { useRailStore, type RailPanel } from "@/store/rail";
import { useSettingsStore } from "@/store/settings";
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

/** Panel đang mở (theo tab bar) phủ lên vùng chart. Cùng nội dung với thanh bên phải của desktop, cộng panel Trading. */
export function MobilePanel() {
  const open = useRailStore((s) => s.open);
  const setOpen = useRailStore((s) => s.setOpen);
  const drafting = useTicketStore(ticketBusy);
  if (!open || (open === "order" && !drafting)) return null;
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
      <div className={`min-h-0 flex-1 ${open === "order" ? "flex flex-col" : open === "trading" ? "" : "overflow-y-auto"}`}>
        {open === "watchlist" ? (
          <WatchlistPanel />
        ) : open === "alerts" ? (
          <AlertsPanel />
        ) : open === "calendar" ? (
          <EconomicCalendarPanel />
        ) : open === "trading" ? (
          <TradingPanel fill />
        ) : (
          <OrderTicket />
        )}
      </div>
    </div>
  );
}
