"use client";

import { INDICATORS, byId } from "@/indicators/registry";
import { useIndicatorStore } from "@/indicators/store";
import { useState, type ReactNode } from "react";
import { Close, Search, StarI, Svg24 as Svg } from "../icons";

const TITLES: Record<string, string> = {
  sma: "Simple moving average",
  ema: "Exponential moving average",
  wma: "Weighted moving average",
  bb: "Bollinger Bands",
  vwap: "Volume-weighted average price",
  volume: "Volume",
  rsi: "Relative strength index",
  macd: "Moving average convergence divergence",
  stoch: "Stochastic",
  atr: "Average true range",
};

type Tab =
  | "fav"
  | "scripts"
  | "purchased"
  | "tech"
  | "fund"
  | "picks"
  | "top"
  | "trending"
  | "market"
  | "onchart";

const EMPTY: Partial<Record<Tab, string>> = {
  scripts: "Chưa có script. Pine editor sẽ thêm ở phase sau.",
  purchased: "Không áp dụng (chạy local).",
  fund: "Chưa hỗ trợ dữ liệu fundamentals.",
  picks: "Không áp dụng (chạy local).",
  top: "Không áp dụng (chạy local).",
  trending: "Không áp dụng (chạy local).",
  market: "Không áp dụng (chạy local).",
};

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
      {
        id: "scripts",
        label: "My scripts",
        icon: (
          <Ico>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c1-5 4-7 8-7s7 2 8 7" />
          </Ico>
        ),
      },
      {
        id: "purchased",
        label: "Purchased",
        icon: (
          <Ico>
            <rect x="3" y="6" width="18" height="14" rx="2" />
            <path d="M3 10h18M16 15h2" />
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
      {
        id: "fund",
        label: "Fundamentals",
        icon: (
          <Ico>
            <rect x="4" y="12" width="4" height="8" />
            <rect x="10" y="8" width="4" height="12" />
            <rect x="16" y="4" width="4" height="16" />
          </Ico>
        ),
      },
    ],
  },
  {
    title: "COMMUNITY",
    items: [
      {
        id: "picks",
        label: "Editors' picks",
        icon: (
          <Ico>
            <path d="M6 3h12v18l-6-4-6 4z" />
          </Ico>
        ),
      },
      {
        id: "top",
        label: "Top",
        icon: (
          <Ico>
            <rect x="4" y="12" width="4" height="8" />
            <rect x="10" y="8" width="4" height="12" />
            <path d="M17 4l3 3-3 3" />
          </Ico>
        ),
      },
      {
        id: "trending",
        label: "Trending",
        icon: (
          <Ico>
            <path d="M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />
          </Ico>
        ),
      },
      {
        id: "market",
        label: "Marketplace",
        icon: (
          <Ico>
            <path d="M4 8h16l-1 12H5zM8 8V6a4 4 0 018 0v2" />
          </Ico>
        ),
      },
    ],
  },
];

const field =
  "w-20 rounded border border-[var(--border)] bg-transparent px-1 py-0.5 text-sm";

function OnChart() {
  const { list, remove, update } = useIndicatorStore();
  if (list.length === 0)
    return (
      <div className="px-4 py-6 text-sm text-[var(--muted)]">
        Chưa có indicator nào trên chart.
      </div>
    );
  return (
    <div className="space-y-2 p-3">
      {list.map((inst) => {
        const def = byId(inst.id);
        return (
          <div
            key={inst.uid}
            className="rounded border border-[var(--border)] p-3"
          >
            <div className="mb-2 flex items-center justify-between text-sm font-semibold">
              {TITLES[inst.id] ?? def.name}
              <button
                className="text-xs text-red-400"
                onClick={() => remove(inst.uid)}
              >
                Remove
              </button>
            </div>
            {def.inputs.map((inp) => (
              <label
                key={inp.key}
                className="mb-1 flex items-center justify-between text-xs"
              >
                {inp.label}
                {inp.type === "number" ? (
                  <input
                    type="number"
                    className={field}
                    min={inp.min}
                    step={inp.step}
                    value={inst.inputs[inp.key] as number}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v > 0)
                        update(inst.uid, {
                          inputs: { ...inst.inputs, [inp.key]: v },
                        });
                    }}
                  />
                ) : (
                  <select
                    className={field}
                    value={inst.inputs[inp.key] as string}
                    onChange={(e) =>
                      update(inst.uid, {
                        inputs: { ...inst.inputs, [inp.key]: e.target.value },
                      })
                    }
                  >
                    {inp.options.map((o) => (
                      <option key={o} className="text-black">
                        {o}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            ))}
            <div className="flex gap-2 pt-1">
              {inst.colors.map((c, k) => (
                <input
                  key={k}
                  type="color"
                  value={c.slice(0, 7)}
                  className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
                  onChange={(e) =>
                    update(inst.uid, {
                      colors: inst.colors.map((x, j) =>
                        j === k ? e.target.value : x,
                      ),
                    })
                  }
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

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

  const query = q.trim().toLowerCase();
  const rows = INDICATORS.filter((d) => {
    if (query)
      return (
        d.name.toLowerCase().includes(query) ||
        (TITLES[d.id] ?? "").toLowerCase().includes(query)
      );
    if (tab === "fav") return favorites.includes(d.id);
    return tab === "tech";
  });
  const count = (id: string) => list.filter((x) => x.id === id).length;
  const showRows = query || tab === "fav" || tab === "tech";

  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        {icon}
        Indicators{list.length ? ` (${list.length})` : ""}
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
                <button
                  onClick={() => {
                    setTab("onchart");
                    setQ("");
                  }}
                  className={`mt-2 flex w-full items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2.5 text-left text-sm ${tab === "onchart" && !query ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]/60"}`}
                >
                  On chart{" "}
                  <span className="text-xs text-[var(--muted)]">
                    {list.length}
                  </span>
                </button>
              </nav>

              <div className="min-w-0 flex-1 overflow-y-auto pr-3">
                {tab === "onchart" && !query ? (
                  <OnChart />
                ) : showRows ? (
                  <>
                    <div className="grid grid-cols-[1fr_120px_80px] px-3 pb-2 text-[11px] font-semibold tracking-wide text-[var(--muted)]">
                      <span className="pl-8">NAME</span>
                      <span>AUTHOR</span>
                      <span>BOOSTS</span>
                    </div>
                    {rows.length === 0 && (
                      <div className="px-3 py-6 text-sm text-[var(--muted)]">
                        {query
                          ? "Không tìm thấy kết quả."
                          : "Chưa có indicator yêu thích. Bấm ngôi sao ở Technicals."}
                      </div>
                    )}
                    {rows.map((d) => (
                      <div
                        key={d.id}
                        onClick={() => add(d.id)}
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
                            {TITLES[d.id] ?? d.name}
                          </span>
                          {count(d.id) > 0 && (
                            <span className="rounded bg-[var(--accent)]/20 px-1.5 text-xs text-[var(--accent)]">
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
                  </>
                ) : (
                  <div className="px-4 py-6 text-sm text-[var(--muted)]">
                    {EMPTY[tab]}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
