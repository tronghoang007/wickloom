"use client";

import { useDrawingStore } from "@/drawings/store";
import { fetchSymbols } from "@/lib/api";
import { useSettingsStore } from "@/store/settings";
import { toggleReplay, useReplayStore } from "@/replay/store";
import { useIndicatorStore } from "@/indicators/store";
import { useChartStore, type ChartType } from "@/store/chart";
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertI,
  AreaIcon,
  BarsIcon,
  CameraI,
  Candles,
  FootprintI,
  CompareI,
  FullscreenI,
  Heikin,
  IndicatorsI,
  LineIcon,
  MoonI,
  Redo,
  Replay,
  SettingsI,
  SunI,
  TemplatesI,
  Undo,
} from "../icons";
import AccountMenu from "./AccountMenu";
import IndicatorsDialog from "./IndicatorsDialog";
import LayoutBar from "./LayoutBar";
import LayoutMenu from "./LayoutMenu";
import SymbolSearchDialog from "./SymbolSearchDialog";
import TimeframeBar from "./TimeframeBar";

const CHART_TYPES: { v: ChartType; label: string; icon: ReactNode }[] = [
  { v: "candles", label: "Candles", icon: <Candles /> },
  { v: "bars", label: "Bars", icon: <BarsIcon /> },
  { v: "line", label: "Line", icon: <LineIcon /> },
  { v: "area", label: "Area", icon: <AreaIcon /> },
  { v: "heikin", label: "Heikin Ashi", icon: <Heikin /> },
];

/** "Volume footprint" không phải một ChartType: là nến + indicator `footprint` (nến chính ẩn đi, indicator tự vẽ nến và các ô theo row giá). */
const FOOTPRINT = { label: "Volume footprint", icon: <FootprintI /> };

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

function SymbolSearch() {
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

export default function Toolbar() {
  const { chartType, theme, set } = useChartStore();
  const api = useDrawingStore((s) => s.api);
  const replayOn = useReplayStore((s) => s.active || s.selecting);
  const [typeOpen, setTypeOpen] = useState(false);
  const { list, add, remove } = useIndicatorStore();
  const fp = list.filter((i) => i.id === "footprint");

  useEffect(() => {
    const load = () =>
      fetchSymbols()
        .then((symbols) => set({ symbols }))
        .catch(() => {});
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [set]);

  const cur = fp.length > 0 ? FOOTPRINT : CHART_TYPES.find((c) => c.v === chartType)!;
  const fullscreen = () =>
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();

  return (
    <div className="flex h-[38px] items-center border-b border-[var(--border)] bg-[var(--page)] pr-1">
      <div className="flex w-[52px] shrink-0 items-center justify-center">
        <AccountMenu />
      </div>
      <SymbolSearch />
      {sep}
      <TimeframeBar className={btn} />
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
              for (const i of fp) remove(i.uid); // chọn kiểu nến khác thì bỏ Volume footprint
              set({ chartType: c.v });
              setTypeOpen(false);
            }}
            className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-sm hover:bg-[var(--hover)]"
          >
            {c.icon} {c.label}
          </button>
        ))}
        <button
          onClick={() => {
            set({ chartType: "candles" });
            if (fp.length === 0) add("footprint");
            setTypeOpen(false);
          }}
          className={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-sm hover:bg-[var(--hover)] ${fp.length > 0 ? "text-[var(--accent-text)]" : ""}`}
        >
          {FOOTPRINT.icon} {FOOTPRINT.label}
        </button>
      </Menu>
      {sep}
      <IndicatorsDialog className={btn} icon={<IndicatorsI />} />
      <button className={iconBtn} disabled title="Indicator templates (sắp có)">
        <TemplatesI />
      </button>
      {sep}
      <button className={btn} disabled title="Alert (sắp có)">
        <AlertI /> Alert
      </button>
      <button
        className={`${btn} ${replayOn ? "bg-[var(--fg)] text-[var(--bg)] hover:bg-[var(--fg)]" : ""}`}
        title="Replay"
        onClick={toggleReplay}
      >
        <Replay /> Replay
      </button>
      {sep}
      <button className={iconBtn} title="Undo" onClick={() => api?.undo()}>
        <Undo />
      </button>
      <button className={iconBtn} title="Redo" onClick={() => api?.redo()}>
        <Redo />
      </button>

      <div className="flex-1" />

      <LayoutMenu className={iconBtn} />
      <LayoutBar />
      {sep}
      <button className={iconBtn} title="Settings" onClick={() => useSettingsStore.setState({ open: true })}>
        <SettingsI />
      </button>
      <button className={iconBtn} title="Fullscreen" onClick={fullscreen}>
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
    </div>
  );
}
