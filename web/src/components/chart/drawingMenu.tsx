import type { DrawingManager } from "@/drawings/manager";
import { useDrawingStore } from "@/drawings/store";
import { SPEC } from "@/drawings/tools";
import type { Drawing } from "@/drawings/types";
import { presetVisibility, type VisPreset } from "@/drawings/visibility";
import { AlertI, Lock, SettingsI, Trash } from "../icons";
import type { MenuItem } from "./ChartContextMenu";

export const VISIBILITY: [VisPreset, string][] = [
  ["above", "Current interval and above"],
  ["below", "Current interval and below"],
  ["only", "Current interval only"],
  ["all", "All intervals"],
];

// Menu của hình đang chọn, thứ tự như TradingView. Dùng cho chuột phải lên hình (đủ mục) và nút
// "..." trên thanh nổi (more: chỉ phần thứ tự / khung / nhân bản / ẩn). Mọi mục tác động lên hình đang
// chọn, nên chuột phải phải chọn hình trước khi mở menu.
export function drawingMenuItems(api: DrawingManager, d: Drawing, tf: string, more = false): MenuItem[] {
  const order: MenuItem = {
    label: "Visual order",
    children: [
      { label: "Bring to front", onSelect: () => api.reorder("front") },
      { label: "Bring forward", onSelect: () => api.reorder("forward") },
      { label: "Send backward", onSelect: () => api.reorder("backward") },
      { label: "Send to back", onSelect: () => api.reorder("back") },
    ],
  };
  const visibility: MenuItem = {
    label: "Visibility on intervals",
    children: VISIBILITY.map(([preset, label]) => ({
      label,
      onSelect: () => api.update({ visibility: presetVisibility(preset, tf) }),
    })),
  };
  const clone: MenuItem = { label: "Clone", onSelect: () => api.cloneSelected() };
  const copy: MenuItem = { label: "Copy", shortcut: "⌘ C", disabled: true };
  const hide: MenuItem = { label: "Hide", onSelect: () => api.update({ hidden: true }) };

  if (more) return [order, visibility, "sep", clone, copy, "sep", hide];
  return [
    { label: `Add alert on ${SPEC[d.type]?.label ?? d.type}…`, icon: <AlertI />, disabled: true },
    "sep",
    order,
    visibility,
    { label: "Object tree…", disabled: true },
    "sep",
    clone,
    copy,
    "sep",
    {
      label: d.locked ? "Unlock" : "Lock",
      icon: <Lock open={!d.locked} />,
      onSelect: () => api.update({ locked: !d.locked }),
    },
    hide,
    { label: "Remove", icon: <Trash />, shortcut: "Del", onSelect: () => api.deleteSelected() },
    "sep",
    {
      label: "Settings…",
      icon: <SettingsI />,
      onSelect: () => useDrawingStore.setState({ settingsOpen: true }),
    },
  ];
}
