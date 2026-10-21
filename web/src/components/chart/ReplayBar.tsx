"use client";

import { TF_SECONDS } from "@/lib/api";
import { SPEEDS, exitReplay, useReplayStore } from "@/replay/store";
import { useChartStore } from "@/store/chart";
import { useState } from "react";
import { Tv } from "../icons";

const TF_LABEL: Record<string, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1h",
  H4: "4h",
  D1: "D",
};

// Cụm control Replay của TV: cao 38px, nút icon vuông 38px (icon 28px, nét 1px), chữ 14px.
const btn =
  "flex h-[38px] min-w-[38px] items-center justify-center gap-1 rounded px-[5px] text-sm hover:bg-[var(--hover)] disabled:opacity-40 disabled:hover:bg-transparent";

// Icon đo theo TV (getBBox trên lưới 28): Select bar 16x18, Play 11x17, Step 13x16, Jump 15x16.
// Tam giác viền bo góc, không tô; vẽ lại, không chép path của TV.
const SelectBarIcon = () => (
  <Tv>
    <rect x="7.5" y="5.500" width="3" height="17" rx="1" />
    <path d="M14.500 14H23M18 10.500L14.500 14l3.500 3.500" />
  </Tv>
);
const PlayIcon = () => (
  <Tv>
    <path d="M9.500 20.400V7.600Q9.500 6 10.800 6.980L18.500 13Q19.800 14 18.500 15L10.800 21.020Q9.500 22 9.500 20.400Z" />
  </Tv>
);
const PauseIcon = () => (
  <Tv>
    <rect x="9.500" y="6.500" width="3" height="15" rx="1" />
    <rect x="15.500" y="6.500" width="3" height="15" rx="1" />
  </Tv>
);
const StepIcon = () => (
  <Tv>
    <path d="M8.500 19.400V8.600Q8.500 7.200 9.600 8.060L16.100 13.140Q17.200 14 16.100 14.860L9.600 19.940Q8.500 20.800 8.500 19.400Z" />
    <path d="M20.500 6V22" />
  </Tv>
);
const JumpIcon = () => (
  <Tv>
    <path d="M7.500 19.400V8.600Q7.500 7.200 8.600 8.060L15.100 13.140Q16.200 14 15.100 14.860L8.600 19.940Q7.500 20.800 7.500 19.400Z" />
    <path d="M19.500 6V22M21.500 6V22" />
  </Tv>
);
const CloseIcon = () => (
  <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeLinecap="round">
    <path d="M1.500 1.500l14 14M15.500 1.500l-14 14" />
  </svg>
);

const Sep = () => <div className="mx-1 h-[22px] w-px bg-[var(--border)]" />;

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
    <div className="relative flex h-[46px] items-center justify-center border-t border-[var(--border)]">
      <button
        className={`${btn} ${selecting ? "bg-[var(--hover)]" : ""}`}
        onClick={() =>
          useReplayStore.setState({ selecting: true, playing: false })
        }
      >
        <SelectBarIcon />
        Select bar
      </button>
      <Sep />
      <button
        className={btn}
        disabled={!active}
        title={playing ? "Pause" : "Play"}
        onClick={() => useReplayStore.setState({ playing: !playing })}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button
        className={btn}
        disabled={!active}
        title="Forward one update"
        onClick={onStep}
      >
        <StepIcon />
      </button>
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
      <Sep />
      <button
        className={btn}
        disabled={!active}
        title="Jump to realtime"
        onClick={exitReplay}
      >
        <JumpIcon />
      </button>
      <button
        className="absolute right-3 flex h-[38px] w-[38px] items-center justify-center rounded hover:bg-[var(--hover)]"
        title="Close replay"
        onClick={exitReplay}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
