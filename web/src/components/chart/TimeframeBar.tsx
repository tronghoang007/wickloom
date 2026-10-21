"use client";

import { TF_SECONDS } from "@/lib/api";
import { TF_MENU, tfLong, tfShort } from "@/lib/timeframes";
import { useChartStore } from "@/store/chart";
import { useEffect, useState } from "react";
import { Chevron, Plus, StarI } from "../icons";

// Các khung "yêu thích" trên toolbar + dropdown đầy đủ như TradingView: nhóm Minutes/Hours/
// Days thu gọn được, ngôi sao để ghim khung lên toolbar. Khung đang chọn mà chưa ghim vẫn
// hiện trên toolbar (TV cũng vậy).
export default function TimeframeBar({ className }: { className: string }) {
  const tf = useChartStore((s) => s.tf);
  const favTfs = useChartStore((s) => s.favTfs);
  const set = useChartStore((s) => s.set);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const shown = [...new Set([...favTfs, tf])]
    .filter((t) => t in TF_SECONDS)
    .sort((a, b) => TF_SECONDS[a] - TF_SECONDS[b]);
  const toggleFav = (t: string) =>
    set({ favTfs: favTfs.includes(t) ? favTfs.filter((x) => x !== t) : [...favTfs, t] });
  const toggleSection = (title: string) =>
    setCollapsed((c) => (c.includes(title) ? c.filter((x) => x !== title) : [...c, title]));

  return (
    <>
      {shown.map((t) => (
        <button
          key={t}
          onClick={() => set({ tf: t })}
          className={`${className} px-2.5 ${t === tf ? "bg-[var(--hover)] font-semibold" : ""}`}
        >
          {tfShort(t)}
        </button>
      ))}
      <div className="relative">
        <button className={`${className} px-1`} onClick={() => setOpen(!open)}>
          <Chevron />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-0 z-40 max-h-screen w-[196px] overflow-y-auto rounded-md bg-[var(--panel)] py-1.5 text-sm shadow-[0_2px_4px_rgba(0,0,0,0.4)]">
              <button
                disabled
                title="Add custom interval (sắp có)"
                className="mx-1.5 flex h-8 w-[184px] items-center gap-2 rounded px-2 text-left disabled:opacity-40"
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
                              className={`flex h-6 w-6 items-center justify-center ${fav ? "text-[var(--fg)]" : "text-[var(--muted)] opacity-0 group-hover:opacity-100"}`}
                            >
                              <StarI on={fav} size={24} />
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
