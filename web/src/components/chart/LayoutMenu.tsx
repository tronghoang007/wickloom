"use client";

import { useLayoutStore } from "@/store/layout";
import { TEMPLATES, buildTemplate, paneRects, type Template } from "@/store/layoutTree";
import { useState } from "react";
import { LayoutI } from "../icons";

const W = 40;
const H = 30;
const GAP = 1.5;

/** Hình thu nhỏ của mẫu, vẽ thẳng từ cây chia ô (không vẽ tay từng icon). */
function TemplateIcon({ t }: { t: Template }) {
  const rects = Object.values(paneRects(buildTemplate(t.id, Array.from({ length: t.count }, (_, i) => `p${i + 1}`))));
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="currentColor" aria-hidden>
      {rects.map((r, i) => (
        <rect key={i} x={r.x * W + GAP} y={r.y * H + GAP} width={r.w * W - 2 * GAP} height={r.h * H - 2 * GAP} rx={2} opacity={0.85} />
      ))}
    </svg>
  );
}

const label = (t: Template) => `${t.count} chart${t.count > 1 ? "s" : ""} (${t.id})`;

/** Nút Layout trên toolbar + popup chọn mẫu chia ô (1–8 chart). */
export default function LayoutMenu({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const templateId = useLayoutStore((s) => s.templateId);
  const setTemplate = useLayoutStore((s) => s.setTemplate);
  const counts = [...new Set(TEMPLATES.map((t) => t.count))];

  return (
    <div className="relative">
      <button className={className} title="Select layout" aria-label="Select layout" onClick={() => setOpen(!open)}>
        <LayoutI />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-40 w-[300px] rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 shadow-2xl">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Select layout</div>
            <div className="space-y-2">
              {counts.map((n) => (
                <div key={n} className="flex items-start gap-2">
                  <span className="mt-2 w-4 shrink-0 text-right text-xs text-[var(--muted)]">{n}</span>
                  <div className="flex flex-wrap gap-1.5">
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
                        className={`rounded border p-0.5 hover:bg-[var(--hover)] ${t.id === templateId ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"}`}
                      >
                        <TemplateIcon t={t} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
