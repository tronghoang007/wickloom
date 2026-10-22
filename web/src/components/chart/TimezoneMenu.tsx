"use client";

import { sortedTimezones, tzMenuLabel } from "@/lib/timefmt";
import { useSettingsStore } from "@/store/settings";
import { useEffect, useRef, useState } from "react";

/** Đồng hồ góc phải thanh dưới ("20:43:07 UTC+7"): bấm vào mở danh sách múi giờ như TradingView; chọn xong đổi cho cả chart (cùng `timezone` với Settings > Symbol). */
export default function TimezoneMenu({ clock }: { clock: string }) {
  const [list, setList] = useState<ReturnType<typeof sortedTimezones> | null>(null); // dựng lúc mở: mức lệch đổi theo giờ mùa hè
  const open = list !== null;
  const tz = useSettingsStore((s) => s.s.timezone);
  const set = useSettingsStore((s) => s.set);
  const current = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    current.current?.scrollIntoView({ block: "center" });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setList(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        className="rounded px-1.5 py-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
        title="Timezone"
        aria-label="Timezone"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setList(open ? null : sortedTimezones(Date.now() / 1000))}
      >
        {clock || "—"}
      </button>
      {list && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setList(null)} />
          <div
            role="listbox"
            className="absolute bottom-full right-0 z-40 mb-1 max-h-[min(440px,calc(100vh-120px))] w-[240px] overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--panel)] py-1 text-sm shadow-[0_2px_4px_rgba(0,0,0,0.4)]"
          >
            {list.map((z) => {
              const on = z.id === tz;
              return (
                <button
                  key={z.id}
                  ref={on ? current : undefined}
                  role="option"
                  aria-selected={on}
                  className={`flex h-8 w-full items-center gap-2 px-3 text-left hover:bg-[var(--hover)] ${on ? "bg-[var(--hover)] font-medium" : ""}`}
                  onClick={() => {
                    set({ timezone: z.id });
                    setList(null);
                  }}
                >
                  <span className="w-3 shrink-0 text-[var(--accent)]">{on ? "✓" : ""}</span>
                  {tzMenuLabel(z)}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
