"use client";

import { TF_SECONDS } from "@/lib/api";
import { SPEEDS, exitReplay, useReplayStore } from "@/replay/store";
import { chartGlobal, useChartStore } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { parseNum } from "@/trading/draft";
import { fmtPnl, fmtPx, pnlClass } from "@/trading/format";
import { currentLot, fmtLotValue, lotSpec, normalizeLot } from "@/trading/lot";
import { pnlSpec } from "@/trading/pnl";
import { emptySim, openPnl, useReplaySim } from "@/trading/replaySim";
import { toast } from "@/store/toast";
import { useEffect, useRef, useState } from "react";
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
  "flex h-[38px] min-w-[38px] items-center justify-center gap-1 rounded px-[5px] text-sm hover:bg-[var(--hover)] disabled:opacity-55 disabled:hover:bg-transparent";

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
          <div className="absolute bottom-10 left-0 z-40 min-w-24 rounded popup py-1">
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

/** Cụm vào lệnh giả lập của Replay (như Replay Trading của TV): Sell | lot | Buy | Flatten. Khớp theo giá nến replay đang chạy, một vị thế gộp cho symbol đang xem, lãi/lỗi tính
 *  theo tick value của MT5 (cần EA >= 2.14, hoặc symbol tính bằng đúng tiền account). Không gửi gì tới MT5. Chi tiết: `trading/replaySim.ts`. */
function ReplayTrade({ paneId, symbol, active }: { paneId: string; symbol: string; active: boolean }) {
  const sim = useReplaySim((s) => s.byPane[paneId]) ?? emptySim(symbol);
  const sym = chartGlobal((s) => s.symbols.find((x) => x.name === symbol));
  const account = useMt5Store((s) => s.accounts.find((a) => a.active));
  const ccy = account?.currency ?? "USD";
  const spec = pnlSpec(sym, ccy);
  const lotSp = lotSpec(sym, account?.max_lot) ?? { min: 0.01, max: 100, step: 0.01 };
  const lotText = sim.lot || fmtLotValue(currentLot(account?.id, symbol, lotSp), lotSp);
  const ready = active && sim.price !== null && spec !== null;
  const hint = !active ? "Chọn nến để bắt đầu Replay" : !spec ? "Chưa biết giá trị một tick của symbol này (cần EA ≥ 2.14)" : sim.price === null ? "Chưa có giá replay" : undefined;
  const order = (side: "buy" | "sell") => spec && useReplaySim.getState().order(paneId, side, normalizeLot(parseNum(lotText), lotSp), spec);
  // SL / TP giả lập vừa tự chốt (nến replay chạm mức): báo một lần cho mỗi sự kiện
  const seen = useRef(sim.event?.id ?? 0);
  useEffect(() => {
    const e = sim.event;
    if (!e || e.id === seen.current) return;
    seen.current = e.id;
    toast(`Replay: ${e.reason === "sl" ? "SL" : "TP"} chạm @ ${fmtPx(e.price, sym?.digits)} · ${fmtPnl(e.pnl)} ${ccy}`, { ms: 5000 });
  }, [sim.event, sym?.digits, ccy]);
  const pnl = openPnl(sim, spec);
  const shownPnl = sim.position ? pnl : sim.trades > 0 ? sim.realized : null;
  const pill = "h-[30px] rounded px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:brightness-100";
  return (
    <div className="mr-12 flex items-center justify-self-end gap-1.5" data-testid="replay-trade" title={hint}>
      {shownPnl !== null && (
        <span className={`mr-1.5 hidden whitespace-nowrap text-xs tabular-nums lg:inline ${pnlClass(shownPnl)}`} data-testid="replay-pnl">
          {sim.position ? "P/L" : "Realized"} {fmtPnl(shownPnl)} {ccy}
        </span>
      )}
      <button type="button" disabled={!ready} className={`${pill} bg-[#f23645]`} onClick={() => order("sell")}>
        Sell
      </button>
      <input
        aria-label="Replay order size"
        inputMode="decimal"
        value={lotText}
        onChange={(e) => useReplaySim.getState().setLot(paneId, e.target.value)}
        onBlur={() => useReplaySim.getState().setLot(paneId, fmtLotValue(normalizeLot(parseNum(lotText), lotSp), lotSp))}
        onKeyDown={(e) => e.stopPropagation()}
        className="h-[30px] w-14 rounded border border-[var(--border)] bg-transparent text-center text-sm tabular-nums outline-none focus:border-[var(--accent)]"
      />
      <button type="button" disabled={!ready} className={`${pill} bg-[#2962ff]`} onClick={() => order("buy")}>
        Buy
      </button>
      <button
        type="button"
        disabled={!sim.position || !spec}
        className="h-[30px] rounded border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
        onClick={() => spec && useReplaySim.getState().flatten(paneId, spec)}
      >
        Flatten
      </button>
    </div>
  );
}

export default function ReplayBar({ paneId, symbol, onStep }: { paneId: string; symbol: string; onStep: () => void }) {
  const { selecting, active, playing, speed, interval } = useReplayStore();
  const tf = useChartStore((s) => s.tf);
  const ivl = interval && TF_SECONDS[interval] < TF_SECONDS[tf] ? interval : tf;
  const intervals = Object.keys(TF_LABEL).filter(
    (k) => TF_SECONDS[k] <= TF_SECONDS[tf],
  );

  return (
    <div className="relative grid h-[46px] grid-cols-[1fr_auto_1fr] items-center border-t border-[var(--border)] px-3">
      <div className="col-start-2 flex items-center">
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
        onClick={() => exitReplay()}
      >
        <JumpIcon />
      </button>
      </div>
      <ReplayTrade paneId={paneId} symbol={symbol} active={active} />
      <button
        className="absolute right-3 flex h-[38px] w-[38px] items-center justify-center rounded hover:bg-[var(--hover)]"
        title="Close replay"
        onClick={() => exitReplay()}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
