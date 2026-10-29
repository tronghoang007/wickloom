"use client";

import { openCreateAlert } from "@/alerts/store";
import { toggleFavorite, useDrawingStore } from "@/drawings/store";
import { GROUPS, SPEC } from "@/drawings/tools";
import { askConfirm } from "@/store/confirm";
import { tfShort } from "@/lib/timeframes";
import { toggleReplay, useReplayStore } from "@/replay/store";
import { useChartStore } from "@/store/chart";
import { startedOn, useLandscape, useLayoutMode } from "@/lib/layoutMode";
import { useLayoutStore } from "@/store/layout";
import { useRailStore, type RailPanel } from "@/store/rail";
import { useSettingsStore } from "@/store/settings";
import { useOrderState } from "@/trading/actions";
import { draftLines } from "@/trading/draft";
import { cancelOwnerEdits, clearEdit, confirmOwnerEdits, pendingFor, seedEditStop, useEditBridge } from "@/trading/editBridge";
import { askCancelOrder, askClosePosition, askRemoveStop } from "@/trading/tagActions";
import type { PendingOrder, Position } from "@/lib/mt5Api";
import { COLORS, fmtLot, fmtPnl, fmtTime, orderLabel, pnlClass, positionPnl, sideColor, sideLabel } from "@/trading/format";
import { fmtLotValue } from "@/trading/lot";
import { useTradeAccount, useTradeStore } from "@/trading/store";
import { quoteOf, useQuoteStore } from "@/trading/quote";
import { seedDraftStop, submitDraft } from "@/trading/submit";
import { ticketBusy, useTicketStore } from "@/trading/ticket";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertI,
  CalendarI,
  CameraI,
  Candles,
  Close,
  FullscreenI,
  Eye,
  Lock,
  Magnet,
  MoonI,
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
import LotSlider from "./LotSlider";
import OrderTicket from "./OrderTicket";
import TimeframeBar from "./TimeframeBar";
import TimeframeRing from "./TimeframeRing";
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

/** Nội dung menu ⋯: các nút của toolbar desktop không còn chỗ trên phone. `onDone`: một mục đã chạy, đóng menu. */
function MoreContent({ onDone }: { onDone: () => void }) {
  const chartType = useChartStore((s) => s.chartType);
  const theme = useChartStore((s) => s.theme);
  const set = useChartStore((s) => s.set);
  const api = useDrawingStore((s) => s.api);
  const replayOn = useReplayStore((s) => s.active || s.selecting);
  const run = (f: () => void) => () => {
    onDone();
    f();
  };
  // iPhone Safari không cho trang web vào fullscreen: không có thì ẩn nút
  const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled;

  return (
    <>
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
    </>
  );
}

/** Vòng chọn khung của phone (TimeframeRing), mở bằng nút khung hoặc chạm nền chart (useRailStore.tfPicker); mục ⋯ của vòng là menu ⋯ (MoreContent).
 *  Bút vẽ (màn Objects) và thêm indicator cũng nằm trong vòng: trên thanh trên chúng sát SELL, dễ bấm nhầm (user 10-29). */
function PhoneRing() {
  const picker = useRailStore((s) => s.tfPicker);
  const at = useRailStore((s) => s.ringAt);
  const indicatorsOpen = useRailStore((s) => s.indicatorsOpen);
  const close = () => useRailStore.setState({ tfPicker: null });
  return (
    <>
      {picker === "ring" && (
        <TimeframeRing
          onClose={close}
          onGrid={() => useRailStore.setState({ tfPicker: "grid" })}
          onDraw={() => (close(), useRailStore.getState().setOpen("objects"))}
          onAddIndicator={() => useRailStore.setState({ tfPicker: null, indicatorsOpen: true })}
          more={<MoreContent onDone={close} />}
          at={at}
        />
      )}
      <IndicatorsDialog open={indicatorsOpen} onClose={() => useRailStore.setState({ indicatorsOpen: false })} />
    </>
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
function ObjectsPanel({ onClose }: { onClose: () => void }) {
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
      <div className="flex items-center justify-between px-5 pb-1 pt-4">
        <h2 className="text-lg font-semibold">Objects</h2>
        <button type="button" className="rounded p-1 hover:bg-[var(--hover)]" onClick={onClose} aria-label="Close">
          <Close />
        </button>
      </div>
      <div className="flex items-center justify-end gap-1 border-b border-[var(--border)] px-3 pb-1.5">
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
      <div className="anim-rise pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel)] py-1 pl-3 pr-1 text-[13px] shadow-lg">
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
  // rộng 80px (user 10-29: "dài ra nữa"), màn hẹp / nhiều nút (chọn chart) thì co lại tới 44px
  const half = `flex h-9 w-20 min-w-11 shrink items-center justify-center rounded-md text-[12px] font-semibold text-white ${block !== null || busy ? "opacity-60" : ""}`;
  return (
    // hai nút tách rời, cách nhau 16px: dính liền thì ngón tay to dễ bấm nhầm hướng (user 10-29; nới từ 8px khi thanh trên bỏ nút Indicators / bút vẽ)
    <div className="flex min-w-0 gap-4" data-testid="trade-widget" title={block ?? undefined}>
      <button type="button" aria-label="Sell at market" className={`${half} bg-[#f23645]`} onClick={() => click("sell")}>
        SELL
      </button>
      <button type="button" aria-label="Buy at market" className={`${half} bg-[#2962ff]`} onClick={() => click("buy")}>
        BUY
      </button>
    </div>
  );
}

/** Thanh công cụ trên cùng của phone (dọc lẫn ngang, như MT5): phẳng, các nút dàn đều cả bề rộng — symbol, khung thời gian, SELL | BUY
 *  (thay thanh SELL / BUY to trên đầu chart), chọn chart. Menu ⋯, bút vẽ và indicators nằm trong vòng chọn khung (PhoneRing). */
export function MobileTopBar() {
  // z-50: popup của thanh này thả xuống đè lên panel phủ chart (z-[45]) bên dưới
  return (
    <div className="relative z-50 flex h-12 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--page)] px-1">
      <SymbolSearch flat />
      <TimeframeBar className={`${btn} min-w-11 justify-center text-[15px]`} compact chevron={false} />
      <TradeButtons />
      <PaneSwitcher />
      <PhoneRing />
    </div>
  );
}

const TABS: { id: RailPanel | null; label: string; icon: ReactNode }[] = [
  { id: "watchlist", label: "Watchlist", icon: <WatchlistI /> }, // thứ tự theo user (10-29): Watchlist, Chart, Trading ở giữa
  { id: null, label: "Chart", icon: <Candles /> },
  { id: "trading", label: "Trading", icon: <TradingI /> },
  { id: "alerts", label: "Alerts", icon: <AlertI /> },
  { id: "calendar", label: "Calendar", icon: <CalendarI /> },
  { id: "account", label: "Account", icon: <AccountAvatar size={26} /> }, // như tab "Menu" của TradingView mobile: avatar không còn trên thanh công cụ
];

/** Tab bar ở đáy: Chart = không panel nào mở; các tab khác mở panel tương ứng phủ lên chart. `vertical`: phone xoay ngang, thành cột dọc bên phải
 *  (màn chỉ cao ~390px, thêm thanh 56px ở đáy thì chart hết chỗ). */
export function MobileTabBar({ vertical = false }: { vertical?: boolean }) {
  useTradePolling(); // panel Trading chỉ mount khi mở tab: hỏi dữ liệu lệnh ở đây cho thẻ lệnh / đường SL-TP trên chart
  useMt5Polling(); // account MT5 (avatar desktop tự hỏi; phone không còn avatar trên thanh)
  useSymbolsPolling(); // danh sách symbol (digits, lot…): thanh trên chỉ có ở tab Chart nên hỏi ở đây
  const open = useRailStore((s) => s.open);
  const setOpen = useRailStore((s) => s.setOpen);
  const symbol = useChartStore((s) => s.symbol);
  const lastSymbol = useRef(symbol);

  // Chọn một symbol trong Watchlist thì về chart luôn (như app TradingView trên điện thoại)
  useEffect(() => {
    if (symbol === lastSymbol.current) return;
    lastSymbol.current = symbol;
    if (useRailStore.getState().open === "watchlist") setOpen(null);
  }, [symbol, setOpen]);

  return (
    <nav className={`flex shrink-0 bg-[var(--page)] ${vertical ? "w-16 flex-col border-l border-[var(--border)]" : "h-14 border-t border-[var(--border)]"}`} aria-label="Panels">
      {TABS.map((t) => {
        // không có tab Order (user 10-29): bảng đặt lệnh là sheet trượt trên tab Chart
        const on = open === t.id || (t.id === null && open === "order");
        return (
          <button
            key={t.label}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${on ? "text-[var(--accent-text)]" : "text-[var(--muted)]"}`}
            aria-current={on ? "page" : undefined}
            onClick={() => {
              // đang soạn / sửa lệnh mà chuyển tab: huỷ luôn bản nháp / thay đổi chờ (user 10-29: đơn giản, không giữ để quay lại)
              const tk = useTicketStore.getState();
              if (ticketBusy(tk)) {
                if (tk.modifyOwner) cancelOwnerEdits(tk.modifyOwner);
                tk.close();
              }
              setOpen(t.id);
            }}
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
 *  Thu gọn chỉ ẩn bảng (vẫn mount): không mất gì đang soạn; đang thu gọn mà vuốt xuống thì huỷ hẳn. */
export function MobileOrderSheet() {
  const open = useRailStore((s) => s.open);
  const drafting = useTicketStore(ticketBusy);
  const id = useTicketStore((s) => s.id);
  const collapsed = useRailStore((s) => s.sheetExpandedFor !== id); // bảng mới (id khác) luôn hiện thu gọn trước
  const setCollapsed = (v: boolean) => useRailStore.setState({ sheetExpandedFor: v ? null : id });
  const startY = useRef<number | null>(null);
  // phone xoay ngang: sheet ở góc dưới bên phải, cao hết màn (60% của ~350px thì không đủ chỗ); tablet luôn ở đáy (đủ cao)
  const turned = useLandscape();
  const mode = useLayoutMode();
  const landscape = turned && mode === "phone";
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
  // thu gọn mà vuốt xuống (bất kỳ chỗ nào trên bảng) = huỷ như MT5 (user 10-29): bỏ bản nháp / thay đổi chờ và đóng bảng
  const cancel = () => {
    const t = useTicketStore.getState();
    if (t.modifyOwner) cancelOwnerEdits(t.modifyOwner);
    t.close();
  };
  if (!shown) return null;
  return (
    <div
      ref={box}
      className={`anim-sheet absolute bottom-0 z-[45] flex flex-col rounded-t-xl border-t border-[var(--border)] bg-[var(--bg)] shadow-[0_-6px_20px_rgba(0,0,0,0.45)] ${
        landscape ? `right-0 w-[min(380px,55%)] border-l ${collapsed ? "" : "max-h-full"}` : `inset-x-0 ${collapsed ? "" : "max-h-[60%]"}`
      } ${collapsed ? "touch-none" : ""}`}
      onPointerDown={(e) => {
        if (!collapsed) return;
        const y0 = e.clientY;
        // nghe ở window: vuốt xuống thì ngón tay thường nhả ra ngoài bảng (trên tab bar)
        const up = (ev: PointerEvent) => {
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          if (ev.type === "pointerup" && ev.clientY - y0 > 40) cancel();
        };
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      }}
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
          if (collapsed && dy > 24) return; // đã thu gọn mà vuốt xuống: huỷ, bảng ngoài lo (onPointerUp ở trên)
          setCollapsed(dy > 24 ? true : dy < -24 ? false : !collapsed); // vuốt xuống thu, vuốt lên mở, chạm thì đảo
        }}
      >
        <span className="h-1 w-10 rounded-full bg-[var(--muted)] opacity-60" />
      </button>
      {/* thu gọn ↔ mở rộng: phần mới hiện mờ dần vào (CSS chạy lại animation khi display none → hiện) */}
      {collapsed && (
        <div className="anim-fade">
          <CollapsedTicket onExpand={() => setCollapsed(false)} />
        </div>
      )}
      <div className={collapsed ? "hidden" : "anim-fade flex min-h-0 flex-1 flex-col"}>
        <OrderTicket />
      </div>
    </div>
  );
}

// nút hành động của dòng thu gọn: có chữ (BUY / SELL / MODIFY / DELETE) thay mũi tên →, cách SL / TP 16px cho đỡ bấm nhầm (user 10-29)
const actionBtn = "flex h-10 min-w-[84px] shrink-0 items-center justify-center rounded-lg px-3 text-[14px] font-semibold text-white disabled:opacity-55";
const rowCls = "flex h-14 items-center gap-4";

/** Bên trái dòng thu gọn: symbol + lệnh; chạm thì mở rộng bảng. */
function RowHead({ symbol, sub, color, onExpand }: { symbol: string; sub: string; color: string; onExpand: () => void }) {
  return (
    <button type="button" className="min-w-0 flex-1 text-left" onClick={onExpand}>
      <div className="truncate text-[15px] font-semibold">{symbol}</div>
      <div className="truncate text-xs" style={{ color }}>{sub}</div>
    </button>
  );
}

/** Dòng của bảng đặt lệnh khi thu gọn (như MT5). Bản nháp: "XAUUSDm  BUY LIMIT 0.01   (SL) (TP) →" — SL / TP bật tắt mức dừng (mức gợi ý như công tắc trong bảng),
 *  → gửi lệnh qua cùng đường với nút đặt lệnh của bảng (kiểm tra bản nháp, báo lỗi bằng toast). Lệnh đã đặt: ModifyRow. */
function CollapsedTicket({ onExpand }: { onExpand: () => void }) {
  const d = useTicketStore((s) => s.draft);
  const owner = useTicketStore((s) => s.modifyOwner);
  const replay = useReplayStore((s) => s.active);
  const quote = useQuoteStore((s) => (d ? quoteOf(s, d.symbol, replay) : undefined));
  const busy = useOrderState((s) => s.busy);
  const data = useTradeStore((s) => s.data);
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
    return <ModifyRow key={owner} owner={owner} pos={pos} ord={ord} onExpand={onExpand} />;
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
    <div className={`${rowCls} px-3 pb-1`}>
      <RowHead symbol={d.symbol} sub={title} color={sideColor(d.side)} onExpand={onExpand} />
      {stop("sl")}
      {stop("tp")}
      <button type="button" aria-label="Đặt lệnh" disabled={busy} className={actionBtn} style={{ background: sideColor(d.side) }} onClick={(e) => startedOn(e) && void submitDraft()}>
        {d.side.toUpperCase()}
      </button>
    </div>
  );
}

/** Dòng thu gọn của lệnh đã đặt, như MT5 (user gửi ảnh 10-29): hai tab "Delete order | Modify order" (vị thế: Close position | Modify position), mở sẵn tab
 *  Delete / Close. Modify: SL, TP, nút MODIFY — SL / TP bật thì thêm mức gợi ý thành thay đổi chờ (kéo trên chart), tắt thì bỏ thay đổi chờ / xoá mức đang có
 *  (hỏi xác nhận như bảng), MODIFY gửi các thay đổi đang chờ. Delete (lệnh chờ): cùng dòng gọn, nút DELETE. Close (vị thế): CloseBlock (thẻ lệnh + đóng một phần). */
function ModifyRow({ owner, pos, ord, onExpand }: { owner: string; pos?: Position; ord?: PendingOrder; onExpand: () => void }) {
  const busy = useOrderState((s) => s.busy);
  const byPane = useEditBridge((s) => s.byPane);
  const digits = useChartStore((s) => s.symbols.find((x) => x.name === (pos ?? ord)!.symbol)?.digits) ?? 5;
  const item = (pos ?? ord)!;
  const edits = pendingFor(byPane, owner);
  const pending = edits.length > 0;
  // như MT5: chạm lệnh mở sẵn tab Delete / Close; vừa kéo đường của lệnh (có thay đổi chờ) thì sang Modify để thấy nút gửi
  const [del, setDel] = useState(!pending);
  const [wasPending, setWasPending] = useState(pending);
  if (pending !== wasPending) {
    setWasPending(pending);
    if (pending) setDel(false);
  }
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
  const tab = (on: boolean, label: string, color: string, onClick: () => void) => (
    <button type="button" aria-pressed={on} className="h-9 text-[15px] font-semibold" style={{ color: on ? color : "var(--muted)" }} onClick={onClick}>
      {label}
    </button>
  );
  const tabs = (
    <div className="flex gap-6 px-1">
      {tab(del, `${kill} ${what}`, "#f23645", () => setDel(true))}
      {tab(!del, `Modify ${what}`, "var(--accent-text)", () => setDel(false))}
    </div>
  );
  if (del && pos) return <CloseBlock pos={pos} tabs={tabs} />;
  const sub = `${pos ? sideLabel(pos.type) : orderLabel(ord!.type)} ${fmtLot(item.volume)} #${item.ticket}`.toUpperCase();
  return (
    <div className="px-3 pb-1">
      {/* Modify và Delete cùng một dòng gọn (user 10-29): chỉ khác nút bên phải */}
      <div className={rowCls}>
        <RowHead
          symbol={item.symbol}
          sub={!del && pending ? `${sub} · chờ xác nhận` : sub}
          color={sideColor((pos ? pos.type : ord!.type).startsWith("buy") ? "buy" : "sell")}
          onExpand={onExpand}
        />
        {del ? (
          <button type="button" aria-label="Delete order" disabled={busy} className={`${actionBtn} bg-[#f23645]`} onClick={(e) => startedOn(e) && askCancelOrder(ord!)}>
            DELETE
          </button>
        ) : (
          <>
            {stop("sl")}
            {stop("tp")}
            <button type="button" aria-label="Confirm" disabled={busy || !pending} className={`${actionBtn} bg-[var(--accent)]`} onClick={(e) => startedOn(e) && confirmOwnerEdits(owner)}>
              MODIFY
            </button>
          </>
        )}
      </div>
      {tabs}
    </div>
  );
}

/** Tab Close position như MT5 (user gửi ảnh 10-29): thẻ lệnh (#ticket, giờ mở, hướng + lot, lãi / lỗ), thanh kéo đóng một phần (lot tối thiểu → cả vị thế),
 *  nút "CLOSE WITH PROFIT / LOSS" kèm lãi / lỗ của phần đóng (ước theo tỉ lệ lot). Đóng qua askClosePosition (phone luôn hỏi xác nhận). */
function CloseBlock({ pos, tabs }: { pos: Position; tabs: ReactNode }) {
  const busy = useOrderState((s) => s.busy);
  const sym = useChartStore((s) => s.symbols.find((x) => x.name === pos.symbol));
  const ccy = useTradeAccount()?.currency ?? "";
  const spec = sym?.volume_min && sym.volume_step && pos.volume > sym.volume_min + 1e-9 ? { min: sym.volume_min, max: pos.volume, step: sym.volume_step } : null;
  const [part, setPart] = useState<{ vol: number; lot: number } | null>(null); // lot muốn đóng, gắn với lot của vị thế lúc chọn (đóng một phần xong thì về cả vị thế)
  const want = part && part.vol === pos.volume ? part.lot : pos.volume;
  const partial = spec !== null && want < pos.volume - 1e-9;
  const profit = positionPnl(pos);
  const share = (profit * want) / pos.volume;
  return (
    <div className="px-3 pb-3">
      {tabs}
      <div className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2.5 text-[13px]">
        <div className="flex justify-between text-[var(--muted)]">
          <span>#{pos.ticket}</span>
          <span className="tabular-nums">{fmtTime(pos.time)}</span>
        </div>
        <div className="mt-1 flex justify-between text-[15px] tabular-nums">
          <span style={{ color: sideColor(pos.type === "buy" ? "buy" : "sell") }}>
            {sideLabel(pos.type)} {fmtLot(pos.volume)}
          </span>
          <span className={pnlClass(profit)}>
            {fmtPnl(profit)} {ccy}
          </span>
        </div>
      </div>
      {spec && (
        <div className="mt-3 px-1">
          <div className="mb-1 flex justify-between text-xs text-[var(--muted)]">
            <span>Đóng</span>
            <span className="tabular-nums">
              {fmtLotValue(want, spec)} / {fmtLot(pos.volume)} lot
            </span>
          </div>
          <LotSlider className="w-full" spec={spec} value={want} onChange={(lot) => setPart({ vol: pos.volume, lot })} />
        </div>
      )}
      <button
        type="button"
        aria-label="Close position"
        disabled={busy}
        className="mt-6 flex h-12 w-full items-center justify-center rounded-lg bg-[#ff9800] text-[15px] font-semibold text-black disabled:opacity-55"
        onClick={(e) => startedOn(e) && askClosePosition(pos, partial ? want : 0)}
      >
        {`CLOSE${partial ? ` ${fmtLotValue(want, spec!)} LOT` : ""} WITH ${share >= 0 ? "PROFIT" : "LOSS"} ${fmtPnl(share)}`}
      </button>
    </div>
  );
}

/** Panel đang mở (theo tab bar) phủ lên vùng chart. Cùng nội dung với thanh bên phải của desktop, cộng panel Trading. */
export function MobilePanel() {
  const open = useRailStore((s) => s.open);
  const setOpen = useRailStore((s) => s.setOpen);
  if (!open || open === "order") return null; // bảng đặt lệnh: MobileOrderSheet
  // Objects: hộp toàn màn có ✕ như hộp Indicators (user 10-29), không phải panel phủ chart dưới thanh trên
  if (open === "objects")
    return (
      <div role="dialog" aria-label="Objects" className="anim-sheet fixed inset-0 z-50 flex flex-col popup pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
        <ObjectsPanel onClose={() => setOpen(null)} />
      </div>
    );
  return (
    // key: đổi tab thì panel mới mờ dần vào
    <div key={open} className="anim-fade absolute inset-0 z-[45] flex flex-col bg-[var(--bg)]">
      {open === "calendar" && (
        // tab của tab bar: không có ✕ (user 10-29)
        <div className="flex items-center border-b border-[var(--border)] px-3 py-2.5">
          <span className="text-[18px] font-semibold leading-6">Economic calendar</span>
        </div>
      )}
      <div className={`min-h-0 flex-1 ${open === "trading" ? "" : "overflow-y-auto"}`}>
        {open === "watchlist" ? (
          <WatchlistPanel />
        ) : open === "alerts" ? (
          <AlertsPanel />
        ) : open === "calendar" ? (
          <EconomicCalendarPanel />
        ) : open === "account" ? (
          <AccountPanel onDone={() => setOpen(null)} />
        ) : (
          <TradingPanel fill />
        )}
      </div>
    </div>
  );
}
