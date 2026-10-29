"use client";

import { INDICATORS } from "@/indicators/catalog";
import { useIndicatorStore } from "@/indicators/store";
import { useVolumeStore } from "@/store/volume";
import { useState, type ReactNode } from "react";
import EmptyState from "../EmptyState";
import { Close, EmptySearchI, Search, StarI, Tv } from "../icons";

type Tab = "fav" | "tech";

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
        icon: <StarI on={false} />, // 28 như TV: sao 21x20
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
          <Tv>
            <path d="M4.5 22h19M7.5 18v-6M11.5 18V7.5M15.5 18v-5M19.5 18v-8" />
          </Tv>
        ),
      },
    ],
  },
];

export default function IndicatorsDialog({
  className = "",
  icon,
  iconOnly = false,
  open: openProp,
  onClose,
}: {
  className?: string;
  icon?: ReactNode;
  /** chỉ hiện icon (chữ "Indicators" thành title): thanh trên của phone */
  iconOnly?: boolean;
  /** điều khiển từ ngoài (phone: mở từ vòng chọn khung), khi đó không có nút mở */
  open?: boolean;
  onClose?: () => void;
}) {
  const [openSelf, setOpenSelf] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openSelf;
  const setOpen = (v: boolean) => (controlled ? !v && onClose?.() : setOpenSelf(v));
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
      {!controlled && (
        <button className={className} title={iconOnly ? "Indicators" : undefined} aria-label="Indicators" onClick={() => setOpen(true)}>
          {icon}
          {!iconOnly && "Indicators"}
        </button>
      )}
      {open && (
        <div
          // phone (max-md): toàn màn, nhóm bên trái thành hàng tab cuộn ngang, bỏ cột AUTHOR
          className="anim-fade fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-6 max-md:pt-0"
          onClick={() => setOpen(false)}
        >
          <div
            className="anim-sheet flex h-[88vh] w-[860px] max-w-[96vw] flex-col rounded-2xl popup max-md:h-dvh max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)] max-md:w-full max-md:max-w-none max-md:rounded-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pb-3 pt-5">
              <h2 className="text-xl font-semibold max-md:text-lg">
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

            <div className="flex min-h-0 flex-1 max-md:flex-col">
              <nav className="w-60 shrink-0 overflow-y-auto px-3 pb-4 max-md:flex max-md:w-auto max-md:gap-1 max-md:overflow-x-auto max-md:pb-2">
                {NAV.map((g) => (
                  <div key={g.title} className="mb-3 max-md:mb-0 max-md:flex max-md:gap-1">
                    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold tracking-wide text-[var(--muted)] max-md:hidden">
                      {g.title}
                    </div>
                    {g.items.map((it) => (
                      <button
                        key={it.id}
                        onClick={() => {
                          setTab(it.id);
                          setQ("");
                        }}
                        className={`flex h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm max-md:w-auto max-md:whitespace-nowrap ${tab === it.id && !query ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]/60"}`}
                      >
                        {it.icon}
                        {it.label}
                      </button>
                    ))}
                  </div>
                ))}
              </nav>

              <div className="min-w-0 flex-1 overflow-y-auto pr-3 max-md:pl-2">
                <div className="grid grid-cols-[1fr_120px_80px] px-3 pb-2 text-[11px] font-semibold tracking-wide text-[var(--muted)] max-md:grid-cols-[1fr_64px]">
                  <span className="pl-6">NAME</span>
                  <span className="max-md:hidden">AUTHOR</span>
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
                    className="group grid cursor-pointer grid-cols-[1fr_120px_80px] items-center rounded px-3 py-2 text-sm hover:bg-[var(--hover)] max-md:grid-cols-[1fr_64px] max-md:py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <button
                        // ô 22x22, sao 15x14 như danh sách indicator của TV (đo: svg 18, sao 15.2x14.5, tên cách mép hàng 30px); -mr-2.5 trừ bớt khoảng gap-3
                        className={`-mr-2.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center ${
                          favorites.includes(d.id)
                            ? "text-[var(--solid,#f2f2f2)]"
                            : "text-[var(--muted)] opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100" // cảm ứng không có hover: luôn hiện sao
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(d.id);
                        }}
                        title="Favorite"
                      >
                        <StarI on={favorites.includes(d.id)} size={20} />
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
                    <span className="text-[var(--muted)] max-md:hidden">Built-in</span>
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
