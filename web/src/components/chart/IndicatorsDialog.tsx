"use client";

import { INDICATORS } from "@/indicators/catalog";
import { useIndicatorStore } from "@/indicators/store";
import { useVolumeStore } from "@/store/volume";
import { useState, type ReactNode } from "react";
import EmptyState from "../EmptyState";
import { Close, EmptySearchI, Search, StarI, Svg24 as Svg } from "../icons";

type Tab = "fav" | "tech";

function Ico({ children }: { children: ReactNode }) {
  return <Svg>{children}</Svg>;
}

const NAV: {
  title: string;
  items: { id: Tab; label: string; icon: ReactNode }[];
}[] = [
  {
    title: "PERSONAL",
    items: [
      {
        id: "fav",
        label: "Favorites",
        icon: (
          <Ico>
            <path d="M12 3l2.700 5.600 6.100.9-4.400 4.300 1 6.100L12 17l-5.400 2.900 1-6.100L3.200 9.500l6.100-.9z" />
          </Ico>
        ),
      },
    ],
  },
  {
    title: "BUILT-IN",
    items: [
      {
        id: "tech",
        label: "Technicals",
        icon: (
          <Ico>
            <path d="M3 20h18M5 16V9M9 16V5M13 16v-5M17 16V8" />
          </Ico>
        ),
      },
    ],
  },
];

export default function IndicatorsDialog({
  className = "",
  icon,
}: {
  className?: string;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("fav");
  const [q, setQ] = useState("");
  const { list, favorites, add, toggleFavorite } = useIndicatorStore();
  const volOn = useVolumeStore((s) => !s.s.removed);

  const query = q.trim().toLowerCase();
  const rows = INDICATORS.filter((d) => {
    if (query)
      return (
        d.name.toLowerCase().includes(query) ||
        d.title.toLowerCase().includes(query)
      );
    if (tab === "fav") return favorites.includes(d.id);
    return tab === "tech";
  });
  const count = (id: string) =>
    id === "volume" ? (volOn ? 1 : 0) : list.filter((x) => x.id === id).length;

  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        {icon}
        Indicators
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex h-[88vh] w-[860px] max-w-[96vw] flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pb-3 pt-5">
              <h2 className="text-xl font-semibold">
                Indicators, metrics, and strategies
              </h2>
              <button
                className="rounded p-1 hover:bg-[var(--hover)]"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <Close />
              </button>
            </div>

            <div className="px-5 pb-3">
              <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 focus-within:border-[var(--accent)]">
                <Search />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search"
                  className="h-11 w-full bg-transparent text-base outline-none"
                />
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              <nav className="w-60 shrink-0 overflow-y-auto px-3 pb-4">
                {NAV.map((g) => (
                  <div key={g.title} className="mb-3">
                    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold tracking-wide text-[var(--muted)]">
                      {g.title}
                    </div>
                    {g.items.map((it) => (
                      <button
                        key={it.id}
                        onClick={() => {
                          setTab(it.id);
                          setQ("");
                        }}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${tab === it.id && !query ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]/60"}`}
                      >
                        {it.icon}
                        {it.label}
                      </button>
                    ))}
                  </div>
                ))}
              </nav>

              <div className="min-w-0 flex-1 overflow-y-auto pr-3">
                <div className="grid grid-cols-[1fr_120px_80px] px-3 pb-2 text-[11px] font-semibold tracking-wide text-[var(--muted)]">
                  <span className="pl-8">NAME</span>
                  <span>AUTHOR</span>
                  <span>BOOSTS</span>
                </div>
                {rows.length === 0 && (
                  <EmptyState icon={query ? <EmptySearchI /> : <StarI on={false} size={32} />} className="min-h-[280px]">
                    {query
                      ? "Không tìm thấy kết quả."
                      : "Chưa có indicator yêu thích. Bấm ngôi sao ở Technicals."}
                  </EmptyState>
                )}
                {rows.map((d) => (
                  <div
                    key={d.id}
                    // Volume đã có sẵn trên chart (indicator "Vol · Ticks"): chọn lại chỉ để thêm lại / hiện lại nó, không thêm pane trùng
                    onClick={() => (d.id === "volume" ? useVolumeStore.getState().set({ removed: false, hidden: false }) : add(d.id))}
                    className="group grid cursor-pointer grid-cols-[1fr_120px_80px] items-center rounded px-3 py-2 text-sm hover:bg-[var(--hover)]"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <button
                        className={
                          favorites.includes(d.id)
                            ? "text-[var(--fg)]"
                            : "text-[var(--muted)] opacity-0 group-hover:opacity-100"
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(d.id);
                        }}
                        title="Favorite"
                      >
                        <StarI on={favorites.includes(d.id)} />
                      </button>
                      <span className="truncate">
                        {d.title}
                      </span>
                      {count(d.id) > 0 && (
                        <span className="rounded bg-[var(--accent)]/20 px-1.5 text-xs text-[var(--accent-text)]">
                          {count(d.id)} on chart
                        </span>
                      )}
                    </span>
                    <span className="text-[var(--muted)]">Built-in</span>
                    <span className="text-[var(--muted)]">
                      {d.overlay ? "overlay" : "pane"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
