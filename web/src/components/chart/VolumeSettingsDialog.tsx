"use client";

import { UNITS, type Unit } from "@/drawings/visibility";
import { useSettingsStore } from "@/store/settings";
import { DEFAULT_VOLUME, useVolumeStore, volColor, type VolumeSettings } from "@/store/volume";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Close } from "../icons";
import ColorPicker from "./ColorPicker";

type Tab = "inputs" | "style" | "visibility";
const TABS: [Tab, string][] = [
  ["inputs", "Inputs"],
  ["style", "Style"],
  ["visibility", "Visibility"],
];

const field = "h-8 rounded-md border border-[var(--border)] bg-transparent px-2 text-[13px] outline-none focus:border-[var(--accent)]";

function Check({ label, checked, onChange, className = "" }: { label: string; checked: boolean; onChange: (v: boolean) => void; className?: string }) {
  return (
    <label className={`flex items-center gap-2.5 py-1.5 ${className}`}>
      <input type="checkbox" className="h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const Section = ({ children }: { children: ReactNode }) => (
  <div className="pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">{children}</div>
);

function Dialog() {
  const s = useVolumeStore((st) => st.s);
  const set = useVolumeStore((st) => st.set);
  const cs = useSettingsStore((st) => st.s);
  const [tab, setTab] = useState<Tab>("inputs");
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  // Chỉnh là áp ngay lên chart (xem trước); Cancel/X/Esc trả về setting lúc mở dialog, Ok giữ lại
  const snapshot = useRef<VolumeSettings>(useVolumeStore.getState().s);

  const close = () => useVolumeStore.setState({ open: false });
  const cancel = useCallback(() => {
    useVolumeStore.getState().replace(snapshot.current);
    useVolumeStore.setState({ open: false });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel]);

  // Như tab Visibility của TV: mỗi đơn vị khung thời gian bật/tắt + khoảng từ–đến
  const range = (u: Unit, max: number) => s.visibility?.[u] ?? { on: true, from: 1, to: max };
  const setVis = (u: Unit, max: number, patch: Partial<{ on: boolean; from: number; to: number }>) => {
    const r = { ...range(u, max), ...patch };
    r.from = Math.max(1, Math.min(max, r.from));
    r.to = Math.max(r.from, Math.min(max, r.to));
    set({ visibility: { ...s.visibility, [u]: r } });
  };
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : fallback);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div
        role="dialog"
        aria-label="Vol settings"
        className="flex max-h-[85vh] w-[min(312px,96vw)] flex-col rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[13px] text-[var(--fg)] shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-lg font-semibold">Vol</h2>
          <button type="button" aria-label="Close" onClick={cancel} className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]">
            <Close />
          </button>
        </div>
        <div className="flex gap-5 border-b border-[var(--border)] px-5">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 py-2 text-sm font-medium ${tab === id ? "border-[var(--fg)]" : "border-transparent text-[var(--muted)]"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-[120px] flex-1 overflow-y-auto px-5 py-3">
          {tab === "inputs" && (
            <>
              <label className="flex items-center justify-between py-1.5">
                MA Length
                <input
                  className={`${field} w-20`}
                  type="number"
                  min={1}
                  value={s.maLength}
                  onChange={(e) => {
                    const n = Math.round(num(e.target.value, s.maLength));
                    if (n >= 1) set({ maLength: n });
                  }}
                />
              </label>
              <Check label="Color based on previous close" checked={s.colorByPrevClose} onChange={(v) => set({ colorByPrevClose: v })} />
            </>
          )}

          {tab === "style" && (
            <>
              <Check label="Volume" checked={s.show} onChange={(v) => set({ show: v })} />
              <div className="flex items-center justify-between py-1.5 pl-6">
                Growing
                <ColorPicker value={volColor(s, cs, true)} onChange={(c) => set({ growing: c })} className="h-7 w-12 p-1" />
              </div>
              <div className="flex items-center justify-between py-1.5 pl-6">
                Falling
                <ColorPicker value={volColor(s, cs, false)} onChange={(c) => set({ falling: c })} className="h-7 w-12 p-1" />
              </div>
              <div className="flex items-center justify-between">
                <Check label="Volume MA" checked={s.maOn} onChange={(v) => set({ maOn: v })} />
                <ColorPicker value={s.maColor} onChange={(c) => set({ maColor: c })} className="h-7 w-12 p-1" />
              </div>

              <Section>Output values</Section>
              <label className="flex items-center justify-between py-1.5">
                Precision
                <select
                  className={`${field} w-28`}
                  value={s.precision ?? "default"}
                  onChange={(e) => set({ precision: e.target.value === "default" ? null : Number(e.target.value) })}
                >
                  <option value="default">Default</option>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <Check label="Labels on price scale" checked={s.priceLabel} onChange={(v) => set({ priceLabel: v })} />
              <Check label="Values in status line" checked={s.statusValues} onChange={(v) => set({ statusValues: v })} />

              <Section>Input values</Section>
              <Check label="Inputs in status line" checked={s.statusInputs} onChange={(v) => set({ statusInputs: v })} />
            </>
          )}

          {tab === "visibility" &&
            UNITS.map(({ id, label, max }) => {
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
        </div>

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
              <div className="absolute bottom-10 left-0 z-10 w-44 rounded-md border border-[var(--border)] bg-[var(--bg)] py-1 shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    // trả về mặc định nhưng giữ trạng thái gỡ/ẩn
                    set({ ...DEFAULT_VOLUME, removed: s.removed, hidden: s.hidden });
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
            <button type="button" onClick={cancel} className="h-8 rounded-md border border-[var(--fg)] px-3 hover:bg-[var(--hover)]">
              Cancel
            </button>
            <button type="button" onClick={close} className="h-8 rounded-md bg-[var(--fg)] px-4 font-medium text-[var(--bg)] hover:opacity-90">
              Ok
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Settings của indicator Volume (Inputs / Style / Visibility) như TV. Mỗi lần mở là một Dialog mới (về tab Inputs, chụp lại setting để Cancel). */
export default function VolumeSettingsDialog() {
  const open = useVolumeStore((st) => st.open);
  return open ? <Dialog /> : null;
}
