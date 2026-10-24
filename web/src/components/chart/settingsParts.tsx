"use client";

import { UNITS, type Unit, type Visibility } from "@/drawings/visibility";
import { useEffect, useState, type ReactNode } from "react";
import { Close } from "../icons";

// Khung dialog Settings dùng chung (Volume, các indicator): header, tab Inputs / Style / Visibility, footer Defaults ▾ · Cancel · Ok.

export type Tab = "inputs" | "style" | "visibility";
const TABS: [Tab, string][] = [
  ["inputs", "Inputs"],
  ["style", "Style"],
  ["visibility", "Visibility"],
];

export const field = "h-8 rounded-md border border-[var(--border)] bg-transparent px-2 text-[13px] outline-none focus:border-[var(--accent)]";

export function Check({ label, checked, onChange, className = "" }: { label: string; checked: boolean; onChange: (v: boolean) => void; className?: string }) {
  return (
    <label className={`flex items-center gap-2.5 py-1.5 ${className}`}>
      <input type="checkbox" className="h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export const Section = ({ children }: { children: ReactNode }) => (
  <div className="pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">{children}</div>
);

export const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : fallback);

/** Như tab Visibility của TV: mỗi đơn vị khung thời gian bật/tắt + khoảng từ–đến. */
export function VisibilityTab({ value, onChange }: { value: Visibility | undefined; onChange: (v: Visibility) => void }) {
  const range = (u: Unit, max: number) => value?.[u] ?? { on: true, from: 1, to: max };
  const setVis = (u: Unit, max: number, patch: Partial<{ on: boolean; from: number; to: number }>) => {
    const r = { ...range(u, max), ...patch };
    r.from = Math.max(1, Math.min(max, r.from));
    r.to = Math.max(r.from, Math.min(max, r.to));
    onChange({ ...value, [u]: r });
  };
  return (
    <>
      {UNITS.map(({ id, label, max }) => {
        const r = range(id, max);
        return (
          <div key={id} className="flex items-center gap-2 py-1.5">
            <label className="flex w-24 items-center gap-2.5">
              <input type="checkbox" className="h-4 w-4" checked={r.on} onChange={(e) => setVis(id, max, { on: e.target.checked })} />
              {label}
            </label>
            <input
              className={`${field} w-[72px]`}
              type="number"
              min={1}
              max={max}
              disabled={!r.on}
              value={r.from}
              onChange={(e) => setVis(id, max, { from: num(e.target.value, r.from) })}
            />
            <span className="text-[var(--muted)]">–</span>
            <input
              className={`${field} w-[72px]`}
              type="number"
              min={1}
              max={max}
              disabled={!r.on}
              value={r.to}
              onChange={(e) => setVis(id, max, { to: num(e.target.value, r.to) })}
            />
          </div>
        );
      })}
    </>
  );
}

/** Chỉnh là áp ngay lên chart (xem trước); Cancel/X/Esc gọi `onCancel` (trả setting lúc mở), Ok gọi `onOk`. Mỗi lần mở là một Frame mới (về tab Inputs). */
export function SettingsFrame({
  title,
  label,
  onCancel,
  onOk,
  onReset,
  width = 312,
  children,
}: {
  title: string;
  label: string;
  width?: number;
  onCancel: () => void;
  onOk: () => void;
  onReset: () => void;
  children: (tab: Tab) => ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("inputs");
  const [defaultsOpen, setDefaultsOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        role="dialog"
        aria-label={label}
        style={{ width: `min(${width}px, 96vw)` }}
        className="flex max-h-[85vh] flex-col rounded-lg popup text-sm"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onCancel} className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]">
            <Close />
          </button>
        </div>
        <div className="flex gap-5 border-b border-[var(--border)] px-5">
          {TABS.map(([id, text]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 py-2 text-sm font-medium ${tab === id ? "border-[var(--fg)]" : "border-transparent text-[var(--muted)]"}`}
            >
              {text}
            </button>
          ))}
        </div>

        <div className="min-h-[120px] flex-1 overflow-y-auto px-5 py-3">{children(tab)}</div>

        <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setDefaultsOpen((v) => !v)}
              className="flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-3 hover:bg-[var(--hover)]"
            >
              Defaults ▾
            </button>
            {defaultsOpen && (
              <div className="absolute bottom-10 left-0 z-10 w-44 rounded-md popup py-1">
                <button
                  type="button"
                  onClick={() => {
                    onReset();
                    setDefaultsOpen(false);
                  }}
                  className="flex h-8 w-full items-center px-3 text-left hover:bg-[var(--hover)]"
                >
                  Reset settings
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="h-8 rounded-md border border-[var(--fg)] px-3 hover:bg-[var(--hover)]">
              Cancel
            </button>
            <button type="button" onClick={onOk} className="h-8 rounded-md bg-[var(--fg)] px-4 font-medium text-[var(--bg)] hover:opacity-90">
              Ok
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
