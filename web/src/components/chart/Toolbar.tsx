"use client";

import { openCreateAlert } from "@/alerts/store";
import { useDrawingStore } from "@/drawings/store";
import { fetchSymbols } from "@/lib/api";
import { useLayoutMode } from "@/lib/layoutMode";
import { useSettingsStore } from "@/store/settings";
import { toggleReplay, useReplayStore } from "@/replay/store";
import { useChartStore, type ChartType } from "@/store/chart";
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertI,
  AreaIcon,
  BarsIcon,
  CameraI,
  Candles,
  CompareI,
  DotsI,
  FullscreenI,
  Heikin,
  IndicatorsI,
  LineIcon,
  MoonI,
  Redo,
  Replay,
  SettingsI,
  SunI,
  Undo,
} from "../icons";
import AccountMenu from "./AccountMenu";
import IndicatorsDialog from "./IndicatorsDialog";
import LayoutBar from "./LayoutBar";
import LayoutMenu from "./LayoutMenu";
import SymbolSearchDialog from "./SymbolSearchDialog";
import TimeframeBar from "./TimeframeBar";

export const CHART_TYPES: { v: ChartType; label: string; icon: ReactNode }[] = [
  { v: "candles", label: "Candles", icon: <Candles /> },
  { v: "bars", label: "Bars", icon: <BarsIcon /> },
  { v: "line", label: "Line", icon: <LineIcon /> },
  { v: "area", label: "Area", icon: <AreaIcon /> },
  { v: "heikin", label: "Heikin Ashi", icon: <Heikin /> },
];

const btn =
  "flex h-[38px] items-center gap-1.5 rounded px-2 text-sm hover:bg-[var(--hover)] disabled:opacity-55 disabled:hover:bg-transparent";
const iconBtn =
  "flex h-[38px] w-[38px] items-center justify-center rounded hover:bg-[var(--hover)] disabled:opacity-55 disabled:hover:bg-transparent";
const sep = <div className="mx-1.5 h-6 w-px bg-[var(--border)]" />;

function Menu({
  trigger,
  children,
  open,
  setOpen,
}: {
  trigger: ReactNode;
  children: ReactNode;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  return (
    <div className="relative">
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-10 z-40 min-w-40 rounded popup py-1">
            {children}
          </div>
        </>
      )}
    </div>
  );
}

export function SymbolSearch() {
  const symbol = useChartStore((s) => s.symbol);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="flex h-9 items-center gap-2 rounded-full bg-[var(--hover)] pl-3 pr-1.5 text-sm font-semibold hover:brightness-125"
        onClick={() => setOpen(true)}
      >
        {symbol}
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg)]">
          <CompareI />
        </span>
      </button>
      {open && <SymbolSearchDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** Danh sách symbol (giá, digits...) hỏi backend 10s một lần. Toolbar desktop và thanh trên của phone đều gọi: luôn có đúng một cái đang mount. */
export function useSymbolsPolling() {
  const set = useChartStore((s) => s.set);
  useEffect(() => {
    const load = () =>
      fetchSymbols()
        .then((symbols) => set({ symbols }))
        .catch(() => {});
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [set]);
}

export const toggleFullscreen = () =>
  document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen();

export default function Toolbar() {
  const { chartType, theme, set } = useChartStore();
  const api = useDrawingStore((s) => s.api);
  const replayOn = useReplayStore((s) => s.active || s.selecting);
  const [typeOpen, setTypeOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useSymbolsPolling();
  // Tablet (768–1279px): khung desktop cần ~1250px nên gom bớt — khung thời gian thành một nút, Indicators / Alert / Replay chỉ còn icon,
  // Undo / Redo / Fullscreen / Snapshot / Theme vào menu ⋯ (thiếu chỗ thì trình duyệt điện thoại thu nhỏ cả trang cho vừa)
  const tablet = useLayoutMode() === "tablet";
  const moreItem = "flex h-10 w-full items-center gap-2.5 whitespace-nowrap px-3 text-left text-sm hover:bg-[var(--hover)]";

  const cur = CHART_TYPES.find((c) => c.v === chartType)!;

  return (
    // tablet: panel bên phải đè lên chart (z-40) — nâng toolbar lên trên để menu thả xuống của nó không bị panel che
    <div className={`flex h-[38px] items-center border-b border-[var(--border)] bg-[var(--page)] pr-1 ${tablet ? "relative z-50" : ""}`}>
      <div className="flex w-[52px] shrink-0 items-center justify-center">
        <AccountMenu />
      </div>
      <SymbolSearch />
      {sep}
      <TimeframeBar className={btn} compact={tablet} />
      {sep}
      <Menu
        open={typeOpen}
        setOpen={setTypeOpen}
        trigger={
          <button className={`${iconBtn} ${typeOpen ? "bg-[var(--hover)]" : ""}`} title={cur.label}>
            {cur.icon}
          </button>
        }
      >
        {CHART_TYPES.map((c) => (
          <button
            key={c.v}
            onClick={() => {
              set({ chartType: c.v });
              setTypeOpen(false);
            }}
            className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-sm hover:bg-[var(--hover)]"
          >
            {c.icon} {c.label}
          </button>
        ))}
      </Menu>
      {sep}
      <IndicatorsDialog className={tablet ? iconBtn : btn} icon={<IndicatorsI />} iconOnly={tablet} />
      {sep}
      <button className={btn} title="Create alert (⌥ A)" onClick={() => void openCreateAlert()}>
        <AlertI /> {!tablet && "Alert"}
      </button>
      <button
        className={`${btn} ${replayOn ? "bg-[var(--fg)] text-[var(--bg)] hover:bg-[var(--fg)]" : ""}`}
        title="Replay"
        onClick={toggleReplay}
      >
        <Replay /> {!tablet && "Replay"}
      </button>
      {!tablet && (
        <>
          {sep}
          <button className={iconBtn} title="Undo" onClick={() => api?.undo()}>
            <Undo />
          </button>
          <button className={iconBtn} title="Redo" onClick={() => api?.redo()}>
            <Redo />
          </button>
        </>
      )}

      <div className="flex-1" />

      <LayoutMenu className={iconBtn} />
      <LayoutBar />
      {sep}
      <button className={iconBtn} title="Settings" onClick={() => useSettingsStore.setState({ open: true })}>
        <SettingsI />
      </button>
      {tablet ? (
        <div className="relative">
          <button className={`${iconBtn} ${moreOpen ? "bg-[var(--hover)]" : ""}`} title="More" aria-label="More" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
            <DotsI />
          </button>
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
              <div className="absolute right-0 top-10 z-40 min-w-48 rounded popup py-1" role="menu">
                <button className={moreItem} onClick={() => api?.undo()}>
                  <Undo /> Undo
                </button>
                <button className={moreItem} onClick={() => api?.redo()}>
                  <Redo /> Redo
                </button>
                {[
                  { label: "Fullscreen", icon: <FullscreenI />, run: () => void toggleFullscreen() },
                  { label: "Take a snapshot", icon: <CameraI />, run: () => window.dispatchEvent(new Event("tv-screenshot")) },
                  { label: theme === "dark" ? "Light theme" : "Dark theme", icon: theme === "dark" ? <SunI /> : <MoonI />, run: () => set({ theme: theme === "dark" ? "light" : "dark" }) },
                ].map((m) => (
                  <button
                    key={m.label}
                    className={moreItem}
                    onClick={() => {
                      setMoreOpen(false);
                      m.run();
                    }}
                  >
                    {m.icon} {m.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <button className={iconBtn} title="Fullscreen" onClick={toggleFullscreen}>
            <FullscreenI />
          </button>
          <button
            className={iconBtn}
            title="Take a snapshot"
            onClick={() => window.dispatchEvent(new Event("tv-screenshot"))}
          >
            <CameraI />
          </button>
          <button
            className={iconBtn}
            title="Toggle theme"
            onClick={() => set({ theme: theme === "dark" ? "light" : "dark" })}
          >
            {theme === "dark" ? <SunI /> : <MoonI />}
          </button>
        </>
      )}
    </div>
  );
}
