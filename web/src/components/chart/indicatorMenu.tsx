import { presetVisibility } from "@/drawings/visibility";
import { byId } from "@/indicators/catalog";
import { MAIN_PANE, effectiveScale, otherPanes, paneKeyOf, type Scale } from "@/indicators/layout";
import { useIndicatorStore } from "@/indicators/store";
import type { IndicatorInstance } from "@/indicators/instance";
import type { IndicatorsPane } from "@/store/paneStores";
import type { StoreApi } from "zustand/vanilla";
import { AlertI, SettingsI, Trash } from "../icons";
import type { MenuItem } from "./ChartContextMenu";
import { VISIBILITY } from "./drawingMenu";

/** Menu "…" của một indicator trên legend, cùng thứ tự với menu của Volume (volumeMenuItems). Mục chưa làm bị khoá. */
export function indicatorMenuItems(store: StoreApi<IndicatorsPane>, inst: IndicatorInstance, tf: string): MenuItem[] {
  const def = byId(inst.id);
  const title = def.name;
  const paneKey = paneKeyOf(inst, def);
  const scale = effectiveScale(inst, def, paneKey);
  const scaleItem = (sc: Scale, label: string): MenuItem => ({
    label: `${scale === sc ? "✓ " : ""}${label}`,
    onSelect: () => store.getState().update(inst.uid, { scale: sc }),
  });
  const fav = useIndicatorStore.getState().favorites.includes(inst.id);
  const st = () => store.getState();
  return [
    { label: `Add alert on ${title}`, icon: <AlertI />, shortcut: "⌥ A", disabled: true },
    { label: `Add indicator/strategy on ${title}…`, disabled: true },
    {
      label: fav ? "Remove this indicator from favorites" : "Add this indicator to favorites",
      onSelect: () => useIndicatorStore.getState().toggleFavorite(inst.id),
    },
    "sep",
    { label: "Visual order", submenu: true, disabled: true },
    {
      label: "Visibility on intervals",
      children: VISIBILITY.map(([preset, label]) => ({
        label,
        onSelect: () => st().update(inst.uid, { visibility: presetVisibility(preset, tf) }),
      })),
    },
    {
      label: "Move to",
      children: [
        { label: "Main pane", disabled: paneKey === MAIN_PANE, onSelect: () => st().update(inst.uid, { pane: MAIN_PANE }) },
        { label: "New pane", onSelect: () => st().update(inst.uid, { pane: `p:${crypto.randomUUID()}` }) },
        ...otherPanes(st().list, inst, byId).map((p): MenuItem => ({ label: `Pane of ${p.label}`, onSelect: () => st().update(inst.uid, { pane: p.key }) })),
      ],
    },
    {
      label: "Pin to scale",
      children: [scaleItem("right", "Right scale"), scaleItem("left", "Left scale"), scaleItem("none", "No scale (overlay)")],
    },
    "sep",
    { label: "Copy", shortcut: "⌘ C", disabled: true },
    { label: inst.hidden ? "Show" : "Hide", onSelect: () => st().update(inst.uid, { hidden: inst.hidden ? undefined : true }) },
    { label: "Remove", icon: <Trash />, onSelect: () => st().remove(inst.uid) },
    "sep",
    { label: "Object tree", disabled: true },
    "sep",
    { label: "Settings…", icon: <SettingsI />, onSelect: () => st().openSettings(inst.uid) },
  ];
}
