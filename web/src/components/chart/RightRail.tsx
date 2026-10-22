"use client";

import { useRailStore, type RailPanel } from "@/store/rail";
import { useTicketStore } from "@/trading/ticket";
import { type ReactNode } from "react";
import { AddOrderI, CalendarI, Close, WatchlistI } from "../icons";
import EconomicCalendarPanel from "./EconomicCalendarPanel";
import OrderTicket from "./OrderTicket";
import WatchlistPanel from "./WatchlistPanel";

const base = "relative flex h-[38px] w-[38px] items-center justify-center rounded";
const cls = (active: boolean) =>
  `${base} ${active ? "bg-[var(--hover)] text-[var(--accent)]" : "text-[var(--fg)] hover:bg-[var(--hover)]"}`;

const TABS: { id: RailPanel; label: string; icon: ReactNode }[] = [
  { id: "watchlist", label: "Watchlist", icon: <WatchlistI /> },
  { id: "calendar", label: "Economic calendar", icon: <CalendarI /> },
  { id: "order", label: "Order", icon: <AddOrderI /> }, // chỉ hiện khi đang soạn lệnh
];

export default function RightRail() {
  const open = useRailStore((s) => s.open);
  const setOpen = useRailStore((s) => s.setOpen);
  const drafting = useTicketStore((s) => s.draft !== null || s.rest !== null); // đang soạn lệnh, hoặc bảng đang chờ sau khi đặt xong
  const tabs = TABS.filter((t) => t.id !== "order" || drafting);
  const active = tabs.find((t) => t.id === open);

  return (
    <div className="flex shrink-0">
      {active && (
        <div className="flex w-[384px] shrink-0 flex-col border-l border-[var(--border)]">
          {open === "calendar" && (
            <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
              <span className="text-sm font-semibold">{active.label}</span>
              <button className="rounded p-1 hover:bg-[var(--hover)]" onClick={() => setOpen(null)} aria-label="Close">
                <Close />
              </button>
            </div>
          )}
          <div className={`min-h-0 flex-1 ${open === "order" ? "flex flex-col" : "overflow-y-auto"}`}>
            {open === "watchlist" ? <WatchlistPanel /> : open === "calendar" ? <EconomicCalendarPanel /> : <OrderTicket />}
          </div>
        </div>
      )}
      <div className="flex w-12 shrink-0 flex-col items-center gap-0.5 border-l border-[var(--border)] py-2">
        {tabs.map((t) => (
          <button key={t.id} className={cls(open === t.id)} title={t.label} onClick={() => setOpen(open === t.id ? null : t.id)}>
            {t.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
