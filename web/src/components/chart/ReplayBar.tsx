"use client";

import { TF_SECONDS } from "@/lib/api";
import { SPEEDS, exitReplay, useReplayStore } from "@/replay/store";
import { useChartStore } from "@/store/chart";
import { useState } from "react";
import { Svg as I } from "../icons";

const TF_LABEL: Record<string, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1h",
  H4: "4h",
  D1: "D",
};

const btn =
  "flex h-9 items-center gap-1.5 rounded px-2.5 text-sm hover:bg-[var(--hover)] disabled:opacity-40 disabled:hover:bg-transparent";

function Pop({
  label,
  options,
  onPick,
}: {
  label: string;
  options: { v: string; label: string }[];
  onPick: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button className={btn} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-10 left-0 z-40 min-w-24 rounded border border-[var(--border)] bg-[var(--bg)] py-1 shadow-xl">
            {options.map((o) => (
              <button
                key={o.v}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--hover)]"
                onClick={() => {
                  onPick(o.v);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function ReplayBar({ onStep }: { onStep: () => void }) {
  const { selecting, active, playing, speed, interval } = useReplayStore();
  const tf = useChartStore((s) => s.tf);
  const ivl = interval && TF_SECONDS[interval] < TF_SECONDS[tf] ? interval : tf;
  const intervals = Object.keys(TF_LABEL).filter(
    (k) => TF_SECONDS[k] <= TF_SECONDS[tf],
  );

  return (
    <div className="relative flex h-12 items-center justify-center gap-1 border-t border-[var(--border)]">
      <button
        className={`${btn} ${selecting ? "bg-[var(--hover)]" : ""}`}
        onClick={() =>
          useReplayStore.setState({ selecting: true, playing: false })
        }
      >
        <I>
          <path d="M4 5v14M8 12h12M12 8l-4 4 4 4" />
        </I>
        Select bar
      </button>
      <div className="mx-2 h-6 w-px bg-[var(--border)]" />
      <button
        className={btn}
        disabled={!active}
        title={playing ? "Pause" : "Play"}
        onClick={() => useReplayStore.setState({ playing: !playing })}
      >
        {playing ? (
          <I>
            <path d="M8 5v14M16 5v14" />
          </I>
        ) : (
          <I>
            <path d="M7 5l12 7-12 7z" />
          </I>
        )}
      </button>
      <button
        className={btn}
        disabled={!active}
        title="Forward one update"
        onClick={onStep}
      >
        <I>
          <path d="M5 5l9 7-9 7zM18 5v14" />
        </I>
      </button>
      <div className="mx-1 h-6 w-px bg-[var(--border)]" />
      <Pop
        label={speed}
        options={Object.keys(SPEEDS).map((v) => ({ v, label: v }))}
        onPick={(v) => useReplayStore.setState({ speed: v })}
      />
      <Pop
        label={TF_LABEL[ivl] ?? ivl}
        options={intervals.map((v) => ({ v, label: `${TF_LABEL[v]} update` }))}
        onPick={(v) => useReplayStore.setState({ interval: v === tf ? "" : v })}
      />
      <div className="mx-1 h-6 w-px bg-[var(--border)]" />
      <button
        className={btn}
        disabled={!active}
        title="Jump to realtime"
        onClick={exitReplay}
      >
        <I>
          <path d="M5 5l9 7-9 7zM18 5v14" />
        </I>
      </button>
      <button
        className="absolute right-3 flex h-9 w-9 items-center justify-center rounded hover:bg-[var(--hover)]"
        title="Close replay"
        onClick={exitReplay}
      >
        <I>
          <path d="M6 6l12 12M18 6L6 18" />
        </I>
      </button>
    </div>
  );
}
