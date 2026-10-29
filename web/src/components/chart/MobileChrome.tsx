"use client";

import { openCreateAlert } from "@/alerts/store";
import { toggleFavorite, useDrawingStore } from "@/drawings/store";
import { GROUPS, SPEC } from "@/drawings/tools";
import { askConfirm } from "@/store/confirm";
import { tfShort } from "@/lib/timeframes";
import { toggleReplay, useReplayStore } from "@/replay/store";
import { useChartStore } from "@/store/chart";
import { startedOn, useLandscape } from "@/lib/layoutMode";
import { useLayoutStore } from "@/store/layout";
import { useRailStore, type RailPanel } from "@/store/rail";
import { useSettingsStore } from "@/store/settings";
import { useOrderState } from "@/trading/actions";
import { draftLines } from "@/trading/draft";
import { clearEdit, confirmOwnerEdits, pendingFor, seedEditStop, useEditBridge } from "@/trading/editBridge";
import { askCancelOrder, askClosePosition, askRemoveStop } from "@/trading/tagActions";
import type { PendingOrder, Position } from "@/lib/mt5Api";
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
  Eye,
  IndicatorsI,
  Lock,
  Magnet,
  MoonI,
  PenI,
  Redo,
  Replay,
  SettingsI,
  StarI,
  Stay,
  SunI,
  Trash,
  TradingI,
  Undo,
  WatchlistI,
} from "../icons";
import { ToolIcon } from "../toolIcons";
import { AccountAvatar, AccountPanel, useMt5Polling } from "./AccountMenu";
import AlertsPanel from "./AlertsPanel";
import EconomicCalendarPanel from "./EconomicCalendarPanel";
import IndicatorsDialog from "./IndicatorsDialog";
import LayoutBar from "./LayoutBar";
import LayoutMenu from "./LayoutMenu";
import OrderTicket from "./OrderTicket";
import TimeframeBar from "./TimeframeBar";
import { CHART_TYPES, SymbolSearch, toggleFullscreen, useSymbolsPolling } from "./Toolbar";
import { useTradeClick } from "./TradeWidget";
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
          <div className={`absolute right-0 z-40 flex flex-col rounded-lg popup py-1 top-11 ${className}`}>{children}</div>
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

/** Nút vẽ trên thanh trên: mở màn Objects; đang cầm công cụ thì sáng lên, bấm nữa là bỏ công cụ. */
function DrawButton() {
  const tool = useDrawingStore((s) => s.tool);
  const api = useDrawingStore((s) => s.api);
  const open = useRailStore((s) => s.open === "objects");
  return (
    <button
      type="button"
      className={`${iconBtn} ${tool || open ? "bg-[var(--hover)] text-[var(--accent-text)]" : ""}`}
      title="Objects"
      aria-label="Objects"
      aria-pressed={!!tool || open}
      onClick={() => (tool ? api?.setTool(null) : useRailStore.getState().setOpen(open ? null : "objects"))}
    >
      <PenI />
    </button>
  );
}

// Công cụ chọn được trên phone: bỏ công cụ "sắp có" và Emoji (cần bảng chọn emoji riêng của thanh vẽ desktop)
const phoneTool = (id: string) => !!SPEC[id] && !SPEC[id].disabled && id !== "emoji";
const toolCell = "relative flex h-[68px] flex-col items-center justify-center gap-1 rounded-md px-1 text-center text-[11px] leading-tight";

function ToolCell({ id, onPick }: { id: string; onPick: (id: string) => void }) {
  const fav = useDrawingStore((s) => s.favorites.includes(id));
  return (
    <div className={`${toolCell} bg-[var(--hover)]`}>
      <button type="button" className="absolute inset-0" aria-label={SPEC[id].label} onClick={() => onPick(id)} />
      <ToolIcon id={id} />
      <span className="line-clamp-2 text-[var(--muted)]">{SPEC[id].label}</span>
      <button
        type="button"
        aria-label={fav ? `Bỏ ${SPEC[id].label} khỏi yêu thích` : `Thêm ${SPEC[id].label} vào yêu thích`}
        aria-pressed={fav}
        className={`absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center ${fav ? "text-[var(--fg)]" : "text-[var(--muted)] opacity-60"}`}
        onClick={() => toggleFavorite(id)}
      >
        <StarI on={fav} size={14} />
      </button>
    </div>
  );
}

/** Màn Objects (như MT5): các nút chung (nam châm, giữ chế độ vẽ, ẩn / hiện, khoá, xoá tất cả), hàng công cụ yêu thích, rồi mọi công cụ theo nhóm.
 *  Chọn một công cụ thì về chart để chạm đặt điểm (thanh DrawingHint báo đang vẽ gì và có nút huỷ). */
function ObjectsPanel() {
  const { favorites, magnet, stay, hideAll, lockAll, api } = useDrawingStore();
  const pick = (id: string) => {
    api?.setTool(id as never);
    useRailStore.getState().setOpen(null);
  };
  const flag = (k: "magnet" | "stay" | "hideAll" | "lockAll", on: boolean, label: string, icon: ReactNode) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      className={`${iconBtn} ${on ? "bg-[var(--hover)] text-[var(--accent-text)]" : ""}`}
      onClick={() => useDrawingStore.setState({ [k]: !on })}
    >
      {icon}
    </button>
  );
  const favs = favorites.filter(phoneTool);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-[var(--border)] px-3 py-1.5">
        <span className="mr-auto text-[18px] font-semibold">Objects</span>
        {flag("magnet", magnet, "Magnet", <Magnet />)}
        {flag("stay", stay, "Stay in drawing mode", <Stay />)}
        {flag("hideAll", hideAll, "Hide all drawings", <Eye off={hideAll} />)}
        {flag("lockAll", lockAll, "Lock all drawings", <Lock open={!lockAll} />)}
        <button
          type="button"
          title="Remove drawings"
          aria-label="Remove drawings"
          className={iconBtn}
          onClick={() =>
            askConfirm({ title: "Xoá hình vẽ", message: "Xoá mọi hình vẽ trên chart này?", confirmLabel: "Xoá", danger: true, onConfirm: () => api?.clearAll() })
          }
        >
          <Trash />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="pb-2 pt-3 text-[11px] font-semibold tracking-wide text-[var(--accent-text)]">FAVORITE OBJECTS</div>
        {favs.length ? (
          <div className="grid grid-cols-4 gap-2">
            {favs.map((id) => (
              <ToolCell key={id} id={id} onPick={pick} />
            ))}
          </div>
        ) : (
          <div className="text-[13px] text-[var(--muted)]">Chạm ngôi sao của một công cụ bên dưới để ghim vào đây.</div>
        )}
        {GROUPS.map((g) =>
          g.sections.map((sec, i) => {
            const ids = sec.ids.filter(phoneTool);
            if (!ids.length) return null;
            return (
              <div key={`${g.id}:${i}`}>
                <div className="pb-2 pt-4 text-[11px] font-semibold tracking-wide text-[var(--muted)]">{sec.title ?? g.label.toUpperCase()}</div>
                <div className="grid grid-cols-4 gap-2">
                  {ids.map((id) => (
                    <ToolCell key={id} id={id} onPick={pick} />
                  ))}
                </div>
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

/** Đang cầm công cụ vẽ trên phone: thanh nhỏ ở đáy chart nói đang vẽ gì + nút huỷ (desktop huỷ bằng chuột phải / Esc, phone không có). */
export function DrawingHint() {
  const tool = useDrawingStore((s) => s.tool);
  const api = useDrawingStore((s) => s.api);
  const open = useRailStore((s) => s.open);
  if (!tool || !SPEC[tool] || open) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[72px] z-[44] flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel)] py-1 pl-3 pr-1 text-[13px] shadow-lg">
        <ToolIcon id={tool} size={22} />
        <span className="truncate">
          {SPEC[tool].label} · <span className="text-[var(--muted)]">chạm lên chart để đặt điểm</span>
        </span>
        <button type="button" aria-label="Huỷ vẽ" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-[var(--hover)]" onClick={() => api?.setTool(null)}>
          <Close size={20} />
        </button>
      </div>
    </div>
  );
}

/** SELL | BUY nhỏ trên thanh trên của phone dọc (như nút giao dịch của MT5), cho symbol của chart đang active: bấm mở bảng đặt lệnh thu gọn,
 *  đang soạn lệnh thì đổi hướng. Không hiện giá (thanh hẹp) — giá bid / ask đã có trên trục giá và trên dòng lệnh. */
function TradeButtons() {
  const symbol = useChartStore((s) => s.symbol);
  const digits = useChartStore((s) => s.symbols.find((x) => x.name === s.symbol)?.digits) ?? 5;
  const replay = useReplayStore((s) => s.active);
  const { block, busy, click } = useTradeClick(symbol, digits, replay);
  const half = `flex h-9 w-11 items-center justify-center rounded-md text-[11px] font-semibold text-white ${block !== null || busy ? "opacity-60" : ""}`;
  return (
    // hai nút tách rời, cách nhau 8px: dính liền thì ngón tay to dễ bấm nhầm hướng (user 10-29)
    <div className="flex shrink-0 gap-2" data-testid="trade-widget" title={block ?? undefined}>
      <button type="button" aria-label="Sell at market" className={`${half} bg-[#f23645]`} onClick={() => click("sell")}>
        SELL
      </button>
      <button type="button" aria-label="Buy at market" className={`${half} bg-[#2962ff]`} onClick={() => click("buy")}>
        BUY
      </button>
    </div>
  );
}

/** Thanh công cụ trên cùng của phone: symbol, khung thời gian, indicators, vẽ, chọn chart, menu ⋯. `flat` (phone dọc, như MT5): phẳng, các nút dàn đều
 *  cả bề rộng, thêm SELL | BUY nhỏ cạnh bút vẽ (thay thanh SELL / BUY to trên đầu chart); phone ngang thì gọn bên trái, SELL / BUY ở widget dưới tiêu đề. */
export function MobileTopBar({ flat = false }: { flat?: boolean }) {
  useSymbolsPolling();
  // z-50: popup của thanh này thả xuống đè lên panel phủ chart (z-[45]) bên dưới
  return (
    <div className={`relative z-50 flex shrink-0 items-center border-b border-[var(--border)] bg-[var(--page)] ${flat ? "h-12 justify-between px-1" : "h-11 gap-0.5 px-1"}`}>
      <SymbolSearch flat={flat} />
      <TimeframeBar className={`${btn} ${flat ? "min-w-11 justify-center text-[15px]" : ""}`} compact chevron={!flat} />
      <IndicatorsDialog className={iconBtn} icon={<IndicatorsI />} iconOnly />
      <DrawButton />
      {flat ? <TradeButtons /> : <div className="flex-1" />}
      <PaneSwitcher />
      <MoreMenu />
    </div>
  );
}

const TABS: { id: RailPanel | null; label: string; icon: ReactNode }[] = [
  { id: "watchlist", label: "Watchlist", icon: <WatchlistI /> }, // thứ tự theo user (10-29): Watchlist, Chart, Trading ở giữa
  { id: null, label: "Chart", icon: <Candles /> },
  { id: "trading", label: "Trading", icon: <TradingI /> },
  { id: "order", label: "Order", icon: <AddOrderI /> }, // chỉ hiện khi đang soạn lệnh (như thanh bên phải)
  { id: "alerts", label: "Alerts", icon: <AlertI /> },
  { id: "calendar", label: "Calendar", icon: <CalendarI /> },
  { id: "account", label: "Account", icon: <AccountAvatar size={26} /> }, // như tab "Menu" của TradingView mobile: avatar không còn trên thanh công cụ
];

/** Tab bar ở đáy: Chart = không panel nào mở; các tab khác mở panel tương ứng phủ lên chart. `vertical`: phone xoay ngang, thành cột dọc bên phải
 *  (màn chỉ cao ~390px, thêm thanh 56px ở đáy thì chart hết chỗ). */
export function MobileTabBar({ vertical = false }: { vertical?: boolean }) {
  useTradePolling(); // panel Trading chỉ mount khi mở tab: hỏi dữ liệu lệnh ở đây cho thẻ lệnh / đường SL-TP trên chart
  useMt5Polling(); // account MT5 (avatar desktop tự hỏi; phone không còn avatar trên thanh)
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
    <nav className={`flex shrink-0 bg-[var(--page)] ${vertical ? "w-16 flex-col border-l border-[var(--border)]" : "h-14 border-t border-[var(--border)]"}`} aria-label="Panels">
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
 *  Bảng mới (bấm SELL / BUY, chạm hay kéo lệnh đã đặt) luôn hiện thu gọn trước, như MT5: chart không bị che.
 *  Thu gọn chỉ ẩn bảng (vẫn mount): không mất gì đang soạn. */
export function MobileOrderSheet() {
  const open = useRailStore((s) => s.open);
  const drafting = useTicketStore(ticketBusy);
  const id = useTicketStore((s) => s.id);
  const collapsed = useRailStore((s) => s.sheetExpandedFor !== id); // bảng mới (id khác) luôn hiện thu gọn trước
  const setCollapsed = (v: boolean) => useRailStore.setState({ sheetExpandedFor: v ? null : id });
  const startY = useRef<number | null>(null);
  const landscape = useLandscape(); // xoay ngang: sheet ở góc dưới bên phải, cao hết màn (60% của ~350px thì không đủ chỗ)
  const shown = open === "order" && drafting;
  // phone dọc: báo mép trên của bảng để khung giá chừa phần bị che (đường SL / TP thấp nhất không nằm sau bảng); ngang thì bảng ở bên phải, không che đáy
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!shown || landscape || !el) return;
    const report = () => useRailStore.setState({ sheetTop: el.getBoundingClientRect().top });
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => {
      ro.disconnect();
      useRailStore.setState({ sheetTop: null });
    };
  }, [shown, landscape]);
  if (!shown) return null;
  return (
    <div
      ref={box}
      className={`absolute bottom-0 z-[45] flex flex-col rounded-t-xl border-t border-[var(--border)] bg-[var(--bg)] shadow-[0_-6px_20px_rgba(0,0,0,0.45)] ${
        landscape ? `right-0 w-[min(380px,55%)] border-l ${collapsed ? "" : "max-h-full"}` : `inset-x-0 ${collapsed ? "" : "max-h-[60%]"}`
      }`}
    >
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
 *  → gửi lệnh qua cùng đường với nút đặt lệnh của bảng (kiểm tra bản nháp, báo lỗi bằng toast). Lệnh đã đặt: ModifyRow. */
function CollapsedTicket({ onExpand }: { onExpand: () => void }) {
  const d = useTicketStore((s) => s.draft);
  const owner = useTicketStore((s) => s.modifyOwner);
  const replay = useReplayStore((s) => s.active);
  const quote = useQuoteStore((s) => (d ? quoteOf(s, d.symbol, replay) : undefined));
  const busy = useOrderState((s) => s.busy);
  const data = useTradeStore((s) => s.data);
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
    return <ModifyRow key={owner} owner={owner} pos={pos} ord={ord} />;
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

/** Dòng thu gọn của lệnh đã đặt, như MT5 (user gửi ảnh 10-29): hai tab "Delete order | Modify order" (vị thế: Close position | Modify position), hàng trên
 *  = nút tên hành động, SL / TP, →. Modify: SL / TP bật thì thêm mức gợi ý thành thay đổi chờ (kéo trên chart), tắt thì bỏ thay đổi chờ / xoá mức đang có
 *  (hỏi xác nhận như bảng), → gửi các thay đổi đang chờ. Delete / Close: → huỷ lệnh chờ / đóng cả vị thế (hỏi xác nhận). */
function ModifyRow({ owner, pos, ord }: { owner: string; pos?: Position; ord?: PendingOrder }) {
  const [del, setDel] = useState(false);
  const busy = useOrderState((s) => s.busy);
  const byPane = useEditBridge((s) => s.byPane);
  const digits = useChartStore((s) => s.symbols.find((x) => x.name === (pos ?? ord)!.symbol)?.digits) ?? 5;
  const item = (pos ?? ord)!;
  const edits = pendingFor(byPane, owner);
  const pending = edits.length > 0;
  const p = pos ? "p" : "o";
  const stop = (kind: "sl" | "tp") => {
    const key = `${p}${kind}:${item.ticket}`;
    const edit = edits.find((x) => x.key === key);
    const on = (edit?.price ?? item[kind]) > 0;
    const toggle = () => {
      if (!on) return seedEditStop(key);
      clearEdit(key);
      if (item[kind] > 0) askRemoveStop({ t: pos ? "position" : "order", ticket: item.ticket }, kind, item[kind], item.symbol, digits);
    };
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-label={kind === "sl" ? "Stop loss" : "Take profit"}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold"
        style={{ borderColor: COLORS[kind], color: on ? "#fff" : COLORS[kind], background: on ? COLORS[kind] : "transparent" }}
        onClick={(e) => startedOn(e) && toggle()}
      >
        {kind.toUpperCase()}
      </button>
    );
  };
  const what = pos ? "position" : "order";
  const kill = pos ? "Close" : "Delete";
  const run = () => (pos ? askClosePosition(pos) : askCancelOrder(ord!));
  const tab = (on: boolean, label: string, color: string, onClick: () => void) => (
    <button type="button" aria-pressed={on} className="h-9 text-[15px] font-semibold" style={{ color: on ? color : "var(--muted)" }} onClick={onClick}>
      {label}
    </button>
  );
  return (
    <div className="px-3 pb-1">
      <div className="flex h-14 items-center gap-2">
        <span
          className={`flex h-10 items-center rounded-full px-4 text-[15px] font-semibold ${del ? "border border-[#f23645] text-[#f23645]" : "bg-[var(--accent)] text-white"}`}
          title={`${item.symbol} ${(pos ? sideLabel(pos.type) : orderLabel(ord!.type)).toUpperCase()} ${fmtLot(item.volume)} #${item.ticket}`}
        >
          {del ? kill.toUpperCase() : "MODIFY"}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">{!del && pending ? "chờ xác nhận" : ""}</span>
        {!del && stop("sl")}
        {!del && stop("tp")}
        <button
          type="button"
          aria-label={del ? `${kill} ${what}` : "Confirm"}
          disabled={busy || (!del && !pending)}
          className={`${roundBtn} text-white`}
          style={{ background: del ? "#f23645" : "var(--accent)" }}
          onClick={(e) => startedOn(e) && (del ? run() : confirmOwnerEdits(owner))}
        >
          <Arrow />
        </button>
      </div>
      <div className="flex gap-6 px-1">
        {tab(del, `${kill} ${what}`, "#f23645", () => setDel(true))}
        {tab(!del, `Modify ${what}`, "var(--accent-text)", () => setDel(false))}
      </div>
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
        ) : open === "objects" ? (
          <ObjectsPanel />
        ) : open === "account" ? (
          <AccountPanel onDone={() => setOpen(null)} />
        ) : (
          <TradingPanel fill />
        )}
      </div>
    </div>
  );
}
