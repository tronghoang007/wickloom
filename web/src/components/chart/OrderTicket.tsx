"use client";

import { fmtMoney, MODE_COLOR, MODE_LABEL } from "@/lib/mt5Format";
import { useAuthStore } from "@/store/auth";
import { chartGlobal } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { placeMarket, placePending, useOrderState } from "@/trading/actions";
import { defaultStop, parseNum, type Draft, type TicketMode } from "@/trading/draft";
import { fmtLot } from "@/trading/format";
import { tradeBlock } from "@/trading/gate";
import { fmtLotValue, lotSpec, normalizeLot, stepLot } from "@/trading/lot";
import { pendingLabel, resolveOrderType, snapPrice, validateMarket, validatePending } from "@/trading/orderType";
import { estimatePnl, pnlSpec, pointsBetween, priceForPnl, priceFromPoints, type PnlSpec } from "@/trading/pnl";
import { useQuoteStore } from "@/trading/quote";
import { useTicketStore } from "@/trading/ticket";
import { useEffect, useState } from "react";
import { Close } from "../icons";

const field = "h-9 w-full rounded border border-[var(--border)] bg-transparent px-2 text-sm tabular-nums outline-none focus:border-[var(--accent)] disabled:opacity-40";
const px = (v: number, digits: number) => v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Bảng đặt lệnh trong thanh bên phải (docs/trade-plan.md T3-T4), bố cục như TradingView: hai ô SELL / BUY giá lớn, Market hoặc Limit/Stop, lot, Take profit / Stop loss mỗi dòng có Giá + Điểm
 *  + Lãi/Lỗ theo tiền account (sửa ô nào hai ô kia tính lại), R:R và mức rủi ro. Entry / SL / TP của bản nháp hiện trên chart thành đường kéo được, kéo thì ô nhập đổi theo (và ngược lại). */
export default function OrderTicket() {
  const draft = useTicketStore((s) => s.draft);
  const id = useTicketStore((s) => s.id);
  return draft ? <TicketPanel key={id} d={draft} /> : <div className="px-4 py-6 text-sm text-[var(--muted)]">Bấm SELL / BUY trên chart để đặt lệnh.</div>;
}

// Ô nhập hiển thị giá trị TÍNH TỪ bản nháp; đang gõ thì giữ đúng chữ người dùng gõ (không bị làm tròn giữa chừng), rời ô thì quay về giá trị tính được.
function Cell({ label, value, onCommit, disabled, suffix, aria }: { label: string; value: string; onCommit: (v: string) => void; disabled?: boolean; suffix?: string; aria: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <div className="min-w-0">
      <label className="mb-1 block text-[11px] text-[var(--muted)]">{label}</label>
      <div className="relative">
        <input
          aria-label={aria}
          className={`${field} ${suffix ? "pr-9" : ""}`}
          inputMode="decimal"
          disabled={disabled}
          placeholder="—"
          value={text ?? value}
          onChange={(e) => {
            setText(e.target.value);
            onCommit(e.target.value);
          }}
          onBlur={() => setText(null)}
          onKeyDown={(e) => e.stopPropagation()} // phím trong ô nhập không phải phím tắt của chart
        />
        {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--muted)]">{suffix}</span>}
      </div>
    </div>
  );
}

type StopProps = {
  kind: "sl" | "tp";
  d: Draft;
  entry: number; // giá vào dùng để đo điểm và lãi/lỗi
  lot: number;
  digits: number;
  tick: number;
  level?: number | null;
  spec: PnlSpec | null;
  ccy: string;
  seedRef: number;
};

// Take profit / Stop loss: bật tắt bằng ô tick, ba ô Giá | Điểm | Lãi (Lỗ) liên thông với nhau
function StopRow({ kind, d, entry, lot, digits, tick, level, spec, ccy, seedRef }: StopProps) {
  const patch = useTicketStore.getState().patch;
  const value = parseNum(d[kind]);
  const on = d[kind].trim() !== "";
  const profit = kind === "tp";
  const set = (p: number | null) => patch({ [kind]: p !== null && p > 0 ? snapPrice(p, tick, digits).toFixed(digits) : "" });
  const toggle = (checked: boolean) => (checked ? set(seedRef > 0 ? defaultStop(kind, d.side, seedRef, tick, digits, level) : null) : patch({ [kind]: "" }));
  const valid = on && value > 0 && entry > 0;
  const points = valid ? String(pointsBetween(entry, value, digits)) : "";
  const amount = valid && spec ? Math.abs(estimatePnl(d.side, lot, entry, value, spec)).toFixed(2) : "";
  const name = profit ? "Take profit" : "Stop loss";
  return (
    <div className="mb-3">
      <label className="mb-1.5 flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" aria-label={`Enable ${name}`} checked={on} onChange={(e) => toggle(e.target.checked)} />
        <span style={{ color: profit ? "#089981" : "#f23645" }}>{name}</span>
      </label>
      <div className="grid grid-cols-3 gap-2">
        <Cell aria={`${name} price`} label="Giá" value={d[kind]} disabled={!on} onCommit={(v) => patch({ [kind]: v })} />
        <Cell aria={`${name} points`} label="Điểm" value={points} disabled={!on || !(entry > 0)} onCommit={(v) => (parseNum(v) > 0 ? set(priceFromPoints(entry, parseNum(v), kind, d.side, digits)) : null)} />
        <Cell
          aria={`${name} amount`}
          label={profit ? "Lãi" : "Lỗ"}
          value={amount}
          suffix={ccy}
          disabled={!on || !spec || !(entry > 0)}
          onCommit={(v) => {
            const n = parseNum(v);
            if (!spec || !(n > 0)) return;
            const p = priceForPnl(d.side, lot, entry, profit ? n : -n, spec);
            if (p !== null) set(p);
          }}
        />
      </div>
    </div>
  );
}

function TicketPanel({ d }: { d: Draft }) {
  const { patch, close } = useTicketStore.getState();
  const sym = chartGlobal((s) => s.symbols.find((x) => x.name === d.symbol));
  const quote = useQuoteStore((s) => s.quotes[d.symbol]);
  const status = useAuthStore((s) => s.status);
  const loaded = useMt5Store((s) => s.loaded);
  const account = useMt5Store((s) => s.accounts.find((a) => a.active));
  const busy = useOrderState((s) => s.busy);
  const spec = lotSpec(sym, account?.max_lot);
  const pnl = pnlSpec(sym);
  const ccy = account?.currency ?? "";
  const digits = sym?.digits ?? 5;
  const tick = sym?.tick_size || 10 ** -digits;
  const [now, setNow] = useState(() => Date.now() / 1000); // để kiểm tra "hết hạn phải ở tương lai" mà không gọi Date.now() lúc render
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 10_000);
    return () => clearInterval(t);
  }, []);

  const buy = d.side === "buy";
  const market = d.mode === "market";
  const price = parseNum(d.price);
  const lot = parseNum(d.lot);
  const sl = parseNum(d.sl);
  const tp = parseNum(d.tp);
  const bid = quote?.bid ?? 0;
  const ask = quote?.ask ?? 0;
  const expiration = d.until && d.untilText ? Math.floor(new Date(d.untilText).getTime() / 1000) : 0;
  const type = !market && quote && price > 0 ? resolveOrderType(d.side, price, bid, ask) : null;
  const gate = tradeBlock({ replay: false, status, loaded, account, spec, hasQuote: !!quote });
  const err =
    gate ??
    (market
      ? validateMarket({ side: d.side, lot, sl, tp, bid, ask, digits, stopsLevel: sym?.stops_level, spec })
      : validatePending({ side: d.side, price, lot, sl, tp, expiration, bid, ask, digits, stopsLevel: sym?.stops_level, spec, nowSec: now })) ??
    (!market && d.until && !expiration ? "Chọn thời điểm hết hạn" : null);

  // Giá vào để đo điểm và lãi/lỗi: giá vào của lệnh chờ, hoặc giá khớp market (Buy mua ở Ask, Sell bán ở Bid)
  const entry = market ? (buy ? ask : bid) : price;
  // Mốc để gợi ý SL/TP khi tick vào ô: lệnh market đo từ giá ĐÓNG vị thế (Buy ở Bid, Sell ở Ask) cho khớp luật của broker
  const seedRef = market ? (buy ? bid : ask) : price;
  const setMode = (mode: TicketMode) => {
    if (mode === d.mode) return;
    // lần đầu sang lệnh chờ chưa có giá vào: gợi ý một mức phía Limit (Buy dưới thị trường, Sell trên)
    const seedPrice = !d.price && quote ? defaultStop("sl", d.side, buy ? ask : bid, tick, digits, sym?.stops_level).toFixed(digits) : d.price;
    patch({ mode, price: seedPrice });
  };

  // R:R và rủi ro (chỉ khi biết đủ để nói đúng)
  const reward = tp > 0 && entry > 0 ? Math.abs(tp - entry) : 0;
  const risk = sl > 0 && entry > 0 ? Math.abs(entry - sl) : 0;
  const lossAmount = pnl && sl > 0 && entry > 0 && lot > 0 ? Math.abs(estimatePnl(d.side, lot, entry, sl, pnl)) : null;
  const riskPct = lossAmount !== null && account?.equity && account.equity > 0 ? (lossAmount / account.equity) * 100 : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (err || busy || !spec) return;
    const volume = normalizeLot(lot, spec);
    const snap = (v: number) => (v > 0 ? snapPrice(v, tick, digits) : 0);
    const ok = market
      ? await placeMarket(d.side, d.symbol, volume, digits, { sl: snap(sl), tp: snap(tp) })
      : await placePending({ symbol: d.symbol, side: d.side, volume, price: snapPrice(price, tick, digits), sl: snap(sl), tp: snap(tp), expiration, expectedType: type }, digits);
    if (ok) close();
  };

  const accent = buy ? "#2962ff" : "#f23645";
  const lotLabel = spec && lot > 0 ? fmtLot(lot) : "";
  const submitLabel = market ? `${buy ? "Buy" : "Sell"} ${lotLabel} ${d.symbol} @ market` : type ? `${pendingLabel(type)} ${lotLabel} ${d.symbol}` : "Place order";

  return (
    <form onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && close()} role="dialog" aria-label="Place order" className="flex flex-col p-4 text-[var(--fg)]">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-base font-semibold">{d.symbol}</span>
        <button type="button" className="rounded p-0.5 text-[var(--muted)] hover:bg-[var(--hover)]" onClick={close} aria-label="Close order panel">
          <Close size={20} />
        </button>
      </div>
      <div className="mb-3 flex items-center gap-2 text-xs text-[var(--muted)]">
        {account ? (
          <>
            <span className="truncate">{account.name || account.broker || account.server}</span>
            {MODE_LABEL[account.mode] && (
              <span className="rounded px-1 py-px text-[10px] font-bold text-white" style={{ background: MODE_COLOR[account.mode] }}>
                {MODE_LABEL[account.mode]}
              </span>
            )}
            {account.equity !== undefined && <span className="tabular-nums">Equity {fmtMoney(account.equity, account.currency)}</span>}
          </>
        ) : (
          <span>Chưa có account MT5</span>
        )}
      </div>

      {/* SELL | BUY giá lớn như TV: bấm ô nào thì đặt hướng đó */}
      <div className="mb-1 grid grid-cols-2 gap-1">
        {(["sell", "buy"] as const).map((s) => {
          const on = d.side === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => patch({ side: s })}
              className={`flex h-14 flex-col items-center justify-center rounded text-white transition ${on ? "ring-2 ring-white/70" : "opacity-45 hover:opacity-80"}`}
              style={{ background: s === "buy" ? "#2962ff" : "#f23645" }}
            >
              <span className="text-[11px] font-medium leading-none">{s === "buy" ? "BUY" : "SELL"}</span>
              <span className="text-lg font-semibold leading-tight tabular-nums">{quote ? px(s === "buy" ? ask : bid, digits) : "—"}</span>
            </button>
          );
        })}
      </div>
      <div className="mb-3 text-center text-[11px] text-[var(--muted)] tabular-nums">{quote ? `Spread ${px(ask - bid, digits)}` : "Chưa có giá thị trường"}</div>

      <div className="mb-3 grid grid-cols-2 border-b border-[var(--border)] text-sm">
        {(["market", "pending"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={d.mode === m} onClick={() => setMode(m)} className={`h-9 border-b-2 ${d.mode === m ? "border-[var(--accent)] font-semibold" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"}`}>
            {m === "market" ? "Market" : "Limit / Stop"}
          </button>
        ))}
      </div>

      {!market && (
        <div className="mb-3">
          <label className="mb-1 block text-xs text-[var(--muted)]">
            Entry price
            <span className="ml-2 font-semibold" style={{ color: accent }} data-testid="ticket-type">
              {type ? pendingLabel(type) : "—"}
            </span>
          </label>
          <input aria-label="Entry price" className={field} inputMode="decimal" value={d.price} onChange={(e) => patch({ price: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          <div className="mt-1 text-[11px] text-[var(--muted)]">{sym?.stops_level ? `Tối thiểu ${sym.stops_level} điểm so với giá thị trường` : " "}</div>
        </div>
      )}

      <div className="mb-3">
        <label className="mb-1 block text-xs text-[var(--muted)]">Lot</label>
        <div className="flex w-40">
          <button type="button" aria-label="Decrease lot" disabled={!spec} className="h-9 w-8 rounded-l border border-r-0 border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-40" onClick={() => spec && patch({ lot: fmtLotValue(stepLot(normalizeLot(lot, spec), -1, spec), spec) })}>
            −
          </button>
          <input aria-label="Lot" className={`${field} rounded-none text-center`} inputMode="decimal" value={d.lot} onChange={(e) => patch({ lot: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          <button type="button" aria-label="Increase lot" disabled={!spec} className="h-9 w-8 rounded-r border border-l-0 border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-40" onClick={() => spec && patch({ lot: fmtLotValue(stepLot(normalizeLot(lot, spec), 1, spec), spec) })}>
            +
          </button>
        </div>
      </div>

      <StopRow kind="tp" d={d} entry={entry} lot={lot} digits={digits} tick={tick} level={sym?.stops_level} spec={pnl} ccy={ccy} seedRef={seedRef} />
      <StopRow kind="sl" d={d} entry={entry} lot={lot} digits={digits} tick={tick} level={sym?.stops_level} spec={pnl} ccy={ccy} seedRef={seedRef} />

      {(reward > 0 && risk > 0) || lossAmount !== null ? (
        <div className="mb-3 space-y-0.5 text-xs text-[var(--muted)] tabular-nums">
          {reward > 0 && risk > 0 && (
            <div>
              Risk / Reward <span className="text-[var(--fg)]">1 : {(reward / risk).toFixed(2)}</span>
            </div>
          )}
          {lossAmount !== null && (
            <div>
              Rủi ro <span className="text-[var(--fg)]">{px(lossAmount, 2)} {ccy}</span>
              {riskPct !== null && <span> ({riskPct.toFixed(2)}% equity)</span>}
            </div>
          )}
        </div>
      ) : null}
      {(d.sl || d.tp) && !pnl && <div className="mb-3 text-[11px] text-[var(--muted)]">Chưa tính được lãi/lỗi: cần EA ≥ 2.14 (tick value của symbol).</div>}

      {!market && (
        <>
          <div className="mb-1 flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <input type="checkbox" checked={d.until} onChange={(e) => patch({ until: e.target.checked })} /> Hết hạn lúc
            </label>
            <input
              aria-label="Expiration"
              type="datetime-local"
              disabled={!d.until}
              value={d.untilText}
              onChange={(e) => patch({ untilText: e.target.value })}
              className="h-8 flex-1 rounded border border-[var(--border)] bg-transparent px-2 text-xs outline-none focus:border-[var(--accent)] disabled:opacity-40"
            />
          </div>
          <div className="mb-3 text-[11px] text-[var(--muted)]">{d.until ? "Theo giờ máy bạn" : "Good till cancelled"}</div>
        </>
      )}

      <div className="mb-2 text-[11px] text-[var(--muted)]">Kéo các đường Entry / SL / TP trên chart để chỉnh.</div>
      <div className="min-h-[18px] text-xs text-[#f23645]" role="alert">
        {err}
      </div>
      <button type="submit" disabled={!!err || busy} className="mt-2 h-11 w-full rounded text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50" style={{ background: accent }}>
        {submitLabel}
      </button>
    </form>
  );
}
