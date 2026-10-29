"use client";

import { TF_SECONDS } from "@/lib/api";
import { TF_MENU, tfLong, tfShort } from "@/lib/timeframes";
import { useChartStore } from "@/store/chart";
import { useRailStore } from "@/store/rail";
import { useEffect, useState } from "react";
import { Chevron, Plus, StarI } from "../icons";

// Các khung "yêu thích" trên toolbar + dropdown đầy đủ như TradingView: nhóm Minutes/Hours/
// Days thu gọn được, ngôi sao để ghim khung lên toolbar. Khung đang chọn mà chưa ghim vẫn
// hiện trên toolbar (TV cũng vậy).
/** `compact` (thanh trên của phone): không bày các khung yêu thích, chỉ một nút "khung đang chọn ⌄" mở dropdown. */
/** `chevron={false}`: thanh trên phẳng của phone dọc (như MT5) chỉ ghi "M15", không mũi tên. */
export default function TimeframeBar({ className, compact = false, chevron = true }: { className: string; compact?: boolean; chevron?: boolean }) {
  const tf = useChartStore((s) => s.tf);
  const favTfs = useChartStore((s) => s.favTfs);
  const set = useChartStore((s) => s.set);
  // phone (compact): trạng thái ở useRailStore.tfPicker vì chạm nền chart cũng mở vòng; vòng trước, nút ⋯ của vòng mới mở lưới đủ khung
  const picker = useRailStore((s) => s.tfPicker);
  const [menuOpen, setMenuOpen] = useState(false);
  const open = compact ? picker !== null : menuOpen;
  const setOpen = (v: boolean) => (compact ? useRailStore.setState({ tfPicker: v ? "ring" : null, ringAt: null }) : setMenuOpen(v));
  const grid = picker === "grid";
  const [collapsed, setCollapsed] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (compact ? useRailStore.setState({ tfPicker: null }) : setMenuOpen(false));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, compact]);

  const shown = [...new Set([...favTfs, tf])]
    .filter((t) => t in TF_SECONDS)
    .sort((a, b) => TF_SECONDS[a] - TF_SECONDS[b]);
  const toggleFav = (t: string) =>
    set({ favTfs: favTfs.includes(t) ? favTfs.filter((x) => x !== t) : [...favTfs, t] });
  const toggleSection = (title: string) =>
    setCollapsed((c) => (c.includes(title) ? c.filter((x) => x !== title) : [...c, title]));

  return (
    <>
      {!compact && shown.map((t) => (
        <button
          key={t}
          onClick={() => set({ tf: t })}
          className={`${className} px-2.5 ${t === tf ? "bg-[var(--hover)] font-semibold" : ""}`}
        >
          {tfShort(t)}
        </button>
      ))}
      <div className="relative">
        <button
          className={`${className} ${compact ? "gap-0.5 px-2 font-semibold" : "px-1"} ${open ? "bg-[var(--hover)]" : ""}`}
          title={compact ? tfLong(tf) : undefined}
          onClick={() => setOpen(!open)}
        >
          {compact && tfShort(tf)}
          {chevron && <Chevron />}
        </button>
        {open && compact && grid && (
          // phone: lưới ô bấm thay danh sách dài phải cuộn (chọn một chạm, như vòng chọn khung của MT5); bỏ ngôi sao yêu thích — chỉ có ý nghĩa với toolbar desktop
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            {/* phone dọc: cả bề rộng dưới thanh trên; rộng hơn (tablet, phone ngang): thả xuống ngay dưới nút */}
            <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+48px)] z-40 rounded-lg bg-[var(--panel)] p-3 shadow-[0_2px_8px_rgba(0,0,0,0.5)] md:absolute md:inset-x-auto md:left-0 md:top-10 md:w-[360px]" role="dialog" aria-label="Timeframe">
              {TF_MENU.map(({ title, tfs }) => (
                <div key={title} className="mb-2 last:mb-0">
                  <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">{title}</div>
                  <div className="grid grid-cols-4 gap-2">
                    {tfs.map((t) => (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={t === tf}
                        onClick={() => {
                          set({ tf: t });
                          setOpen(false);
                        }}
                        className={`h-11 rounded-md text-sm ${t === tf ? "bg-[var(--accent)] font-semibold text-white" : "bg-[var(--hover)]"}`}
                      >
                        {title === "Days" ? tfLong(t) : tfShort(t)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {open && !compact && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-0 z-40 max-h-screen w-[196px] overflow-y-auto rounded-md bg-[var(--panel)] py-1.5 text-sm shadow-[0_2px_4px_rgba(0,0,0,0.4)]">
              <button
                disabled
                title="Add custom interval (sắp có)"
                className="mx-1.5 flex h-8 w-[184px] items-center gap-2 rounded px-2 text-left disabled:opacity-55"
              >
                <Plus size={20} /> Add custom interval…
              </button>
              {TF_MENU.map(({ title, tfs }) => {
                const closed = collapsed.includes(title);
                return (
                  <div key={title}>
                    <button
                      className="flex w-full items-center justify-between pb-[3px] pl-3.5 pr-[18px] pt-[18px] text-[11px] font-medium uppercase leading-4 tracking-wide text-[var(--muted)]"
                      onClick={() => toggleSection(title)}
                    >
                      {title}
                      <span className={closed ? "" : "rotate-180"}>
                        <Chevron />
                      </span>
                    </button>
                    {!closed &&
                      tfs.map((t) => {
                        const fav = favTfs.includes(t);
                        return (
                          <div
                            key={t}
                            onClick={() => {
                              set({ tf: t });
                              setOpen(false);
                            }}
                            className={`group mx-1.5 flex h-8 cursor-pointer items-center rounded px-2 hover:bg-[var(--hover)] ${t === tf ? "bg-[var(--hover)]" : ""}`}
                          >
                            <span className="flex-1">{tfLong(t)}</span>
                            <button
                              title={fav ? "Remove from favorites" : "Add to favorites"}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFav(t);
                              }}
                              className={`mr-px flex h-[18px] w-[18px] shrink-0 items-center justify-center ${fav ? "text-[var(--solid,#f2f2f2)]" : "text-[var(--muted)] opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100"}`}
                            >
                              <StarI on={fav} size={20} />
                            </button>
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
