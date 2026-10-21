"use client";

import { useState, type ReactNode } from "react";
import { CalendarI, Close, WatchlistI } from "../icons";
import EconomicCalendarPanel from "./EconomicCalendarPanel";
import WatchlistPanel from "./WatchlistPanel";

type PanelId = "watchlist" | "calendar";

const base = "relative flex h-[38px] w-[38px] items-center justify-center rounded";
const cls = (active: boolean) =>
  `${base} ${active ? "bg-[var(--hover)] text-[var(--accent)]" : "text-[var(--fg)] hover:bg-[var(--hover)]"}`;

const TABS: { id: PanelId; label: string; icon: ReactNode }[] = [
  { id: "watchlist", label: "Watchlist", icon: <WatchlistI /> },
  { id: "calendar", label: "Economic calendar", icon: <CalendarI /> },
];

export default function RightRail() {
  const [open, setOpen] = useState<PanelId | null>(null);
  const active = TABS.find((t) => t.id === open);

  return (
    <div className="flex shrink-0">
      {active && (
        <div className="flex w-[384px] shrink-0 flex-col border-l border-[var(--border)]">
          {open === "calendar" && (
            <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
              <span className="text-sm font-semibold">{active.label}</span>
              <button
                className="rounded p-1 hover:bg-[var(--hover)]"
                onClick={() => setOpen(null)}
                aria-label="Close"
              >
                <Close />
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {open === "watchlist" ? <WatchlistPanel /> : <EconomicCalendarPanel />}
          </div>
        </div>
      )}
      <div className="flex w-12 shrink-0 flex-col items-center gap-0.5 border-l border-[var(--border)] py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={cls(open === t.id)}
            title={t.label}
            onClick={() => setOpen(open === t.id ? null : t.id)}
          >
            {t.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
