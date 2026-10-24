"use client";

import { useLayoutStore } from "@/store/layout";
import { SYNC_KEYS } from "@/store/layoutDoc";
import { TEMPLATES, buildTemplate, paneRects, type Template } from "@/store/layoutTree";
import { useState } from "react";
import { LayoutI } from "../icons";

// Kích thước theo popup layout thật của TV (docs/tv-layout-reference.md §2): nút 29×27, icon 21×19, bước hàng 41px, rộng 428px.
const W = 19;
const H = 17;

/** Icon của mẫu: khung bo góc + các đường chia, vẽ thẳng từ cây chia ô (không vẽ tay từng icon). */
function TemplateIcon({ t }: { t: Template }) {
  const rects = Object.values(paneRects(buildTemplate(t.id, Array.from({ length: t.count }, (_, i) => `p${i + 1}`))));
  const eps = 1e-6;
  return (
    <svg width={21} height={19} viewBox={`-1 -1 ${W + 2} ${H + 2}`} fill="none" stroke="currentColor" strokeWidth={1} aria-hidden>
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={2.5} />
      {rects.map((r, i) => (
        <g key={i}>
          {r.x > eps && <line x1={r.x * W} x2={r.x * W} y1={r.y * H} y2={(r.y + r.h) * H} />}
          {r.y > eps && <line x1={r.x * W} x2={(r.x + r.w) * W} y1={r.y * H} y2={r.y * H} />}
        </g>
      ))}
    </svg>
  );
}

const label = (t: Template) => `${t.count} chart${t.count > 1 ? "s" : ""} (${t.id})`;

// Tooltip của TV (nguyên văn).
const SYNC_ROWS: Record<(typeof SYNC_KEYS)[number], { label: string; tip: string }> = {
  symbol: { label: "Symbol", tip: "Symbol changes on all charts within the layout" },
  interval: { label: "Interval", tip: "Interval changes on all charts within the layout" },
  crosshair: { label: "Crosshair", tip: "Crosshair is synced across all charts within the layout" },
  time: { label: "Time", tip: "When a chart is clicked, all charts within the layout display the same point of time" },
  dateRange: { label: "Date range", tip: "Date range changes on all charts within the layout" },
};

const Info = () => (
  <svg width={14} height={14} viewBox="0 0 14 14" fill="currentColor" aria-hidden>
    <path fillRule="evenodd" d="M7 13A6 6 0 1 0 7 1a6 6 0 0 0 0 12Zm-.75-8.75a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM6.25 6.5h1.5v4h-1.5v-4Z" />
  </svg>
);

function Switch({ on, onChange, name }: { on: boolean; onChange: (v: boolean) => void; name: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={name}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${on ? "bg-[var(--fg)]" : "bg-[var(--border)]"}`}
    >
      <span className={`absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-[var(--bg)] transition-transform ${on ? "translate-x-4" : ""}`} />
    </button>
  );
}

/** Nút Layout trên toolbar + popup chọn mẫu chia ô (1–8 chart) và khối "Sync in layout", theo popup của TV. */
export default function LayoutMenu({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const templateId = useLayoutStore((s) => s.templateId);
  const setTemplate = useLayoutStore((s) => s.setTemplate);
  const sync = useLayoutStore((s) => s.sync);
  const setSync = useLayoutStore((s) => s.setSync);
  const multi = useLayoutStore((s) => s.order.length > 1);
  const counts = [...new Set(TEMPLATES.map((t) => t.count))];

  return (
    <div className="relative">
      <button className={`${className} ${open ? "bg-[var(--hover)]" : ""}`} title="Select layout" aria-label="Select layout" aria-expanded={open} onClick={() => setOpen(!open)}>
        <LayoutI />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-10 z-40 max-h-[calc(100vh-56px)] w-[428px] max-w-[96vw] overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--bg)] pb-2 pt-3 shadow-2xl"
            role="dialog"
            aria-label="Select layout"
          >
            <div className="px-3">
              {counts.map((n) => (
                <div key={n} className="flex min-h-[41px] items-center border-t border-[var(--border)] first:border-t-0">
                  <span className="w-[18px] pl-0.5 text-sm text-[var(--muted)]">{n}</span>
                  <div className="ml-[2px] flex flex-wrap items-center gap-x-[10px] gap-y-1 py-[7px]">
                    {TEMPLATES.filter((t) => t.count === n).map((t) => (
                      <button
                        key={t.id}
                        title={label(t)}
                        aria-label={label(t)}
                        aria-pressed={t.id === templateId}
                        onClick={() => {
                          setTemplate(t.id);
                          setOpen(false);
                        }}
                        className={`flex h-[27px] w-[29px] items-center justify-center rounded ${t.id === templateId ? "bg-[var(--fg)] text-[var(--bg)]" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"}`}
                      >
                        <TemplateIcon t={t} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-3">
              <div className="border-t border-[var(--border)] px-0.5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">Sync in layout</div>
              <div className={multi ? "" : "opacity-55"} title={multi ? undefined : "Cần ít nhất 2 chart"}>
                {SYNC_KEYS.map((k) => (
                  <div key={k} className="flex h-8 items-center justify-between px-0.5 text-sm">
                    <span className="flex items-center gap-2">
                      {SYNC_ROWS[k].label}
                      <span className="text-[var(--muted)]" title={SYNC_ROWS[k].tip}>
                        <Info />
                      </span>
                    </span>
                    <Switch on={sync[k]} name={SYNC_ROWS[k].label} onChange={(v) => setSync({ [k]: v })} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
