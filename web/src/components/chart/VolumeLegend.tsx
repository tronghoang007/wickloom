"use client";

import { presetVisibility } from "@/drawings/visibility";
import type { Bar } from "@/lib/api";
import { useIndicatorStore } from "@/indicators/store";
import { useSettingsStore } from "@/store/settings";
import { fmtVol, useVolumeStore, volColor, volDigits, volMaAt, volUp } from "@/store/volume";
import { AlertI, SettingsI, Trash } from "../icons";
import type { MenuItem } from "./ChartContextMenu";
import { VISIBILITY } from "./drawingMenu";
import { splitColor } from "./ColorPicker";
import { DotsIc, EyeIc, GearIc, IconBtn, TrashIc } from "./legendButtons";

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
    <div className={`group/vol pointer-events-auto -ml-1 flex w-fit items-center gap-x-1.5 rounded border border-transparent bg-[var(--legend-bg)] pl-1 pr-1 hover:border-[var(--border)] ${vs.hidden ? "opacity-50" : ""}`}>
      {showTitle && <span className="text-[var(--fg)]">{TITLE}</span>}
      {showInputs && <span className="text-[var(--muted)]">{vs.maLength}</span>}
      {showValues && (
        <>
          <span style={{ color }}>{fmtVol(bar.v, digits)}</span>
          {ma !== null && <span style={{ color: vs.maColor }}>{fmtVol(ma, digits)}</span>}
        </>
      )}
      <span className="hidden items-center group-hover/vol:flex">
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
