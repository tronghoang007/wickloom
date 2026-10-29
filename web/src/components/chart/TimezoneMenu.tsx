"use client";

import { sortedTimezones, tzMenuLabel } from "@/lib/timefmt";
import { useSettingsStore } from "@/store/settings";
import { useEffect, useRef, useState } from "react";

/** Đồng hồ góc phải thanh dưới ("20:43:07 UTC+7"): bấm vào mở danh sách múi giờ như TradingView; chọn xong đổi cho cả chart (cùng `timezone` với Settings > Symbol). */
/** `timeOnly` (phone, ô góc dưới trục giá): chỉ giờ, chữ nhỏ, không "UTC+7" (user 10-29) — vừa bề rộng trục giá; bấm vẫn mở danh sách múi giờ. */
export default function TimezoneMenu({ clock, timeOnly = false }: { clock: string; timeOnly?: boolean }) {
  const [list, setList] = useState<ReturnType<typeof sortedTimezones> | null>(null); // dựng lúc mở: mức lệch đổi theo giờ mùa hè
  const open = list !== null;
  const tz = useSettingsStore((s) => s.s.timezone);
  const set = useSettingsStore((s) => s.set);
  const current = useRef<HTMLButtonElement>(null);
  // danh sách định vị cố định theo nút (phone: nút nằm trong vùng chart bị cắt phần tràn): mép phải theo nút, cao từ ngay trên nút tới đầu vùng chart
  // (dưới thanh trên, không bị nó đè) — user 10-29: dài hết màn; đo lúc mở
  const [at, setAt] = useState({ right: 0, bottom: 0, maxH: 440 });

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
        className={`rounded px-1.5 py-1 hover:bg-[var(--hover)] hover:text-[var(--fg)] ${open ? "bg-[var(--hover)] text-[var(--fg)]" : "text-[var(--muted)]"}`}
        title="Timezone"
        aria-label="Timezone"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => {
          const top = e.currentTarget.closest("main")?.getBoundingClientRect().top ?? 0;
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ right: Math.max(4, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 4, maxH: Math.max(200, r.top - top - 12) });
          setList(open ? null : sortedTimezones(Date.now() / 1000));
        }}
      >
        {!clock ? (
          "—"
        ) : timeOnly ? (
          <span className="text-[11px] tabular-nums">{clock.split(" ")[0]}</span>
        ) : (
          clock
        )}
      </button>
      {list && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setList(null)} />
          <div
            role="listbox"
            className="fixed z-40 w-[240px] overflow-y-auto popup rounded-md py-1 text-sm"
            style={{ right: at.right, bottom: at.bottom, maxHeight: at.maxH }}
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
                  <span className="w-3 shrink-0 text-[var(--accent-text)]">{on ? "✓" : ""}</span>
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
