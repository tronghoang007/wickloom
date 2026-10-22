import { presetVisibility } from "@/drawings/visibility";
import { byId } from "@/indicators/catalog";
import { useIndicatorStore } from "@/indicators/store";
import type { IndicatorInstance } from "@/indicators/instance";
import type { IndicatorsPane } from "@/store/paneStores";
import type { StoreApi } from "zustand/vanilla";
import { AlertI, SettingsI, Trash } from "../icons";
import type { MenuItem } from "./ChartContextMenu";
import { VISIBILITY } from "./drawingMenu";

/** Menu "…" của một indicator trên legend, cùng thứ tự với menu của Volume (volumeMenuItems). Mục chưa làm bị khoá. */
export function indicatorMenuItems(store: StoreApi<IndicatorsPane>, inst: IndicatorInstance, tf: string): MenuItem[] {
  const title = byId(inst.id).name;
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
    { label: "Move to", submenu: true, disabled: true },
    { label: "Pin to scale", submenu: true, disabled: true },
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
