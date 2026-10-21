"use client";

import { presetVisibility } from "@/drawings/visibility";
import type { Bar } from "@/lib/api";
import { useIndicatorStore } from "@/indicators/store";
import { useSettingsStore } from "@/store/settings";
import { fmtVol, useVolumeStore, volColor, volDigits, volMaAt, volUp } from "@/store/volume";
import type { ReactNode } from "react";
import { AlertI, SettingsI, Trash } from "../icons";
import type { MenuItem } from "./ChartContextMenu";
import { VISIBILITY } from "./drawingMenu";
import { splitColor } from "./ColorPicker";

const TITLE = "Vol · Ticks"; // MT5 chỉ có tick volume

/** Menu của indicator Volume, thứ tự như TV: nút "…" trên hàng legend và chuột phải lên cột volume. */
export function volumeMenuItems(tf: string): MenuItem[] {
  const vol = () => useVolumeStore.getState();
  const fav = useIndicatorStore.getState().favorites.includes("volume");
  return [
    { label: `Add alert on ${TITLE}`, icon: <AlertI />, shortcut: "⌥ A", disabled: true },
    { label: `Add indicator/strategy on ${TITLE}…`, disabled: true },
    {
      label: fav ? "Remove this indicator from favorites" : "Add this indicator to favorites",
      onSelect: () => useIndicatorStore.getState().toggleFavorite("volume"),
    },
    "sep",
    { label: "Visual order", submenu: true, disabled: true },
    {
      label: "Visibility on intervals",
      children: VISIBILITY.map(([preset, label]) => ({
        label,
        onSelect: () => vol().set({ visibility: presetVisibility(preset, tf) }),
      })),
    },
    { label: "Move to", submenu: true, disabled: true },
    { label: "Pin to scale", submenu: true, disabled: true },
    "sep",
    { label: "Copy", shortcut: "⌘ C", disabled: true },
    { label: vol().s.hidden ? "Show" : "Hide", onSelect: () => vol().set({ hidden: !vol().s.hidden }) },
    { label: "Remove", icon: <Trash />, onSelect: () => vol().set({ removed: true }) },
    "sep",
    { label: "Object tree", disabled: true },
    "sep",
    { label: "Settings…", icon: <SettingsI />, onSelect: () => useVolumeStore.setState({ open: true }) },
  ];
}

// nến có thời gian `t` trong mảng đã sắp theo thời gian (-1 nếu không có)
function indexOf(bars: Bar[], t: number) {
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return bars[lo]?.t === t ? lo : -1;
}

// Icon của nút hover trên hàng legend: lưới 18 hiện đúng 18px như TV, nét 1.2 và bo tròn
// (icon lưới 28px thu nhỏ bị mờ và thô)
const Ic = ({ children }: { children: ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const EyeIc = ({ off }: { off: boolean }) => (
  <Ic>
    <path d="M1.5 9C3.3 5.8 6 4 9 4s5.7 1.8 7.5 5c-1.8 3.2-4.5 5-7.5 5S3.3 12.2 1.5 9z" />
    <circle cx="9" cy="9" r="2.4" />
    {off && <path d="M3 15L15 3" />}
  </Ic>
);
const GearIc = () => (
  <Ic>
    <path d="M15.55 10.47L13.55 13.94Q12.70 15.41 11.00 15.41L7.00 15.41Q5.30 15.41 4.45 13.94L2.45 10.47Q1.60 9.00 2.45 7.53L4.45 4.06Q5.30 2.59 7.00 2.59L11.00 2.59Q12.70 2.59 13.55 4.06L15.55 7.53Q16.40 9.00 15.55 10.47z" />
    <circle cx="9" cy="9" r="2.4" />
  </Ic>
);
const TrashIc = () => (
  <Ic>
    <path d="M3 5h12M7 5V3.8a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8V5M4.5 5l.7 8.7a1.3 1.3 0 0 0 1.3 1.2h5a1.3 1.3 0 0 0 1.3-1.2L13.5 5M7.5 7.6v4.6M10.5 7.6v4.6" />
  </Ic>
);
const DotsIc = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
    <circle cx="3.5" cy="9" r="1.5" />
    <circle cx="9" cy="9" r="1.5" />
    <circle cx="14.5" cy="9" r="1.5" />
  </svg>
);

function IconBtn({ title, onClick, children }: { title: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-5 w-7 items-center justify-center rounded text-[var(--fg)] hover:bg-[var(--hover)]"
    >
      {children}
    </button>
  );
}

/** Hàng legend của indicator Volume ("Vol · Ticks 1.05 K"): rê chuột vào hiện nút ẩn / Settings / gỡ / menu. */
export default function VolumeLegend({
  getBars,
  bar,
  prev,
  onMenu,
}: {
  getBars: () => Bar[];
  bar: Bar | undefined;
  prev: number | null | undefined;
  onMenu: (x: number, y: number) => void;
}) {
  const vs = useVolumeStore((st) => st.s);
  const set = useVolumeStore((st) => st.set);
  const cs = useSettingsStore((st) => st.s);
  if (vs.removed) return null;

  const digits = volDigits(vs);
  const color = splitColor(volColor(vs, cs, bar ? volUp(bar, prev ?? undefined, vs) : true)).base;
  const bars = bar && vs.maOn ? getBars() : [];
  const ma = bar && vs.maOn ? volMaAt(bars, indexOf(bars, bar.t), vs.maLength) : null;
  const showTitle = cs.showIndicatorTitles;
  const showInputs = cs.showIndicatorInputs && vs.statusInputs && vs.maOn;
  const showValues = vs.statusValues && !vs.hidden && bar;

  return (
    <div className={`group pointer-events-auto flex w-fit items-center gap-x-1.5 rounded border border-transparent pr-1 hover:border-[var(--border)] ${vs.hidden ? "opacity-50" : ""}`}>
      {showTitle && <span className="text-[var(--fg)]">{TITLE}</span>}
      {showInputs && <span className="text-[var(--muted)]">{vs.maLength}</span>}
      {showValues && (
        <>
          <span style={{ color }}>{fmtVol(bar.v, digits)}</span>
          {ma !== null && <span style={{ color: vs.maColor }}>{fmtVol(ma, digits)}</span>}
        </>
      )}
      <span className="hidden items-center group-hover:flex">
        <IconBtn title={vs.hidden ? "Show" : "Hide"} onClick={() => set({ hidden: !vs.hidden })}>
          <EyeIc off={vs.hidden} />
        </IconBtn>
        <IconBtn title="Settings" onClick={() => useVolumeStore.setState({ open: true })}>
          <GearIc />
        </IconBtn>
        <IconBtn title="Remove" onClick={() => set({ removed: true })}>
          <TrashIc />
        </IconBtn>
        <IconBtn
          title="More"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onMenu(r.left, r.bottom + 4);
          }}
        >
          <DotsIc />
        </IconBtn>
      </span>
    </div>
  );
}
