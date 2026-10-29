"use client";

import { useLayoutMode } from "@/lib/layoutMode";
import { useRailStore, type RailPanel } from "@/store/rail";
import { ticketBusy, useTicketStore } from "@/trading/ticket";
import { type ReactNode } from "react";
import { AlertI, CalendarI, Close, WatchlistI } from "../icons";
import AlertsPanel from "./AlertsPanel";
import EconomicCalendarPanel from "./EconomicCalendarPanel";
import OrderTicket from "./OrderTicket";
import WatchlistPanel from "./WatchlistPanel";

const base = "relative flex h-[38px] w-[38px] items-center justify-center rounded";
const cls = (active: boolean) =>
  `${base} ${active ? "bg-[var(--hover)] text-[var(--accent-text)]" : "text-[var(--fg)] hover:bg-[var(--hover)]"}`;

const TABS: { id: RailPanel; label: string; icon: ReactNode }[] = [
  { id: "watchlist", label: "Watchlist", icon: <WatchlistI /> },
  { id: "alerts", label: "Alerts", icon: <AlertI /> },
  { id: "calendar", label: "Economic calendar", icon: <CalendarI /> },
];

export default function RightRail() {
  const open = useRailStore((s) => s.open);
  const setOpen = useRailStore((s) => s.setOpen);
  const drafting = useTicketStore(ticketBusy);
  // bảng đặt lệnh không có nút riêng trên cột icon (user 10-29): mở bằng SELL / BUY hay chọn lệnh trên chart, đóng bằng ✕ của bảng
  const active = open !== null && (open !== "order" || drafting);
  // tablet: panel 384px đè lên chart (bên trái cột icon) thay vì đẩy chart hẹp lại — màn 820px mà đẩy thì chart chỉ còn ~330px
  const overlay = useLayoutMode() === "tablet";

  return (
    <div className="relative flex shrink-0">
      {active && (
        <div key={open} className={`anim-panel flex w-[384px] shrink-0 flex-col border-l border-[var(--border)] ${overlay ? "absolute inset-y-0 right-full z-40 bg-[var(--bg)] shadow-[-6px_0_20px_rgba(0,0,0,0.45)]" : ""}`}>
          {open === "calendar" && (
            <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
              <span className="text-[18px] font-semibold leading-6">{TABS.find((t) => t.id === "calendar")!.label}</span>
              <button className="rounded p-1 hover:bg-[var(--hover)]" onClick={() => setOpen(null)} aria-label="Close">
                <Close />
              </button>
            </div>
          )}
          <div className={`min-h-0 flex-1 ${open === "order" ? "flex flex-col" : "overflow-y-auto"}`}>
            {open === "watchlist" ? <WatchlistPanel /> : open === "alerts" ? <AlertsPanel /> : open === "calendar" ? <EconomicCalendarPanel /> : <OrderTicket />}
          </div>
        </div>
      )}
      <div className="flex w-12 shrink-0 flex-col items-center gap-0.5 border-l border-[var(--border)] py-2">
        {TABS.map((t) => (
          <button key={t.id} className={cls(open === t.id)} title={t.label} onClick={() => setOpen(open !== t.id ? t.id : null)}>
            {t.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
