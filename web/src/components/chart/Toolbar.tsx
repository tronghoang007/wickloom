"use client";

import { useDrawingStore } from "@/drawings/store";
import { TIMEFRAMES, fetchSymbols } from "@/lib/api";
import { toggleReplay, useReplayStore } from "@/replay/store";
import { useChartStore, type ChartType } from "@/store/chart";
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertI,
  AreaIcon,
  BarsIcon,
  CameraI,
  Candles,
  Chevron,
  CompareI,
  FullscreenI,
  Heikin,
  IdeaI,
  IndicatorsI,
  LayoutI,
  LineIcon,
  MoonI,
  PlusCircle,
  QuickSearchI,
  Redo,
  Replay,
  SettingsI,
  SunI,
  TemplatesI,
  Undo,
} from "../icons";
import IndicatorsDialog from "./IndicatorsDialog";
import SymbolSearchDialog from "./SymbolSearchDialog";

const TF_LABEL: Record<string, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1h",
  H4: "4h",
  D1: "D",
  W1: "W",
  MN1: "M",
};
const QUICK_TF = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];

const CHART_TYPES: { v: ChartType; label: string; icon: ReactNode }[] = [
  { v: "candles", label: "Candles", icon: <Candles /> },
  { v: "bars", label: "Bars", icon: <BarsIcon /> },
  { v: "line", label: "Line", icon: <LineIcon /> },
  { v: "area", label: "Area", icon: <AreaIcon /> },
  { v: "heikin", label: "Heikin Ashi", icon: <Heikin /> },
];

const btn =
  "flex h-9 items-center gap-1.5 rounded px-2 text-sm hover:bg-[var(--hover)] disabled:opacity-40 disabled:hover:bg-transparent";
const iconBtn =
  "flex h-9 w-9 items-center justify-center rounded hover:bg-[var(--hover)] disabled:opacity-40 disabled:hover:bg-transparent";
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
          <div className="absolute left-0 top-10 z-40 min-w-40 rounded border border-[var(--border)] bg-[var(--bg)] py-1 shadow-xl">
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
  const { tf, chartType, theme, set } = useChartStore();
  const api = useDrawingStore((s) => s.api);
  const replayOn = useReplayStore((s) => s.active || s.selecting);
  const [tfOpen, setTfOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);

  useEffect(() => {
    const load = () =>
      fetchSymbols()
        .then((symbols) => set({ symbols }))
        .catch(() => {});
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [set]);

  const cur = CHART_TYPES.find((c) => c.v === chartType)!;
  const fullscreen = () =>
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();

  return (
    <div className="flex h-12 items-center border-b border-[var(--border)] px-2">
      <SymbolSearch />
      <button
        className={`${iconBtn} ml-1`}
        disabled
        title="Compare or add symbol (sắp có)"
      >
        <PlusCircle />
      </button>
      {sep}
      {QUICK_TF.map((t) => (
        <button
          key={t}
          onClick={() => set({ tf: t })}
          className={`${btn} px-2.5 ${t === tf ? "bg-[var(--hover)] font-semibold" : ""}`}
        >
          {TF_LABEL[t]}
        </button>
      ))}
      <Menu
        open={tfOpen}
        setOpen={setTfOpen}
        trigger={
          <button className={`${btn} px-1`}>
            <Chevron />
          </button>
        }
      >
        {TIMEFRAMES.map((t) => (
          <button
            key={t}
            onClick={() => {
              set({ tf: t });
              setTfOpen(false);
            }}
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--hover)]"
          >
            {TF_LABEL[t]}{" "}
            <span className="text-xs text-[var(--muted)]">{t}</span>
          </button>
        ))}
      </Menu>
      {sep}
      <Menu
        open={typeOpen}
        setOpen={setTypeOpen}
        trigger={
          <button className={iconBtn} title={cur.label}>
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
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--hover)]"
          >
            {c.icon} {c.label}
          </button>
        ))}
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
        className={`${btn} ${replayOn ? "bg-white text-black hover:bg-white" : ""}`}
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

      <button className={iconBtn} disabled title="Layout (sắp có)">
        <LayoutI />
      </button>
      <div className="mx-1 flex flex-col items-start leading-none">
        <span className="text-sm font-medium">Default</span>
        <span className="text-[10px] text-[var(--accent)]">Save</span>
      </div>
      <button className={`${iconBtn} w-6`} disabled>
        <Chevron />
      </button>
      {sep}
      <button className={iconBtn} disabled title="Quick search (sắp có)">
        <QuickSearchI />
      </button>
      <button className={iconBtn} disabled title="Settings (sắp có)">
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
      <button className={iconBtn} disabled title="Ideas (sắp có)">
        <IdeaI />
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
