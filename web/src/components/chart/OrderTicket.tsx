"use client";

import { fmtMoney, MODE_COLOR, MODE_LABEL } from "@/lib/mt5Format";
import { useAuthStore } from "@/store/auth";
import { chartGlobal } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { useOrderState } from "@/trading/actions";
import { parseNum, type Draft } from "@/trading/draft";
import { draftError } from "@/trading/draftCheck";
import { fmtLot } from "@/trading/format";
import { fmtLotValue, lotSpec, normalizeLot, stepLot, writeLot } from "@/trading/lot";
import { pendingLabel, resolveOrderType, snapPrice } from "@/trading/orderType";
import { estimatePnl, pnlSpec, pointsBetween, priceForPnl, priceFromPoints, type PnlSpec } from "@/trading/pnl";
import { spreadPips, useQuoteStore } from "@/trading/quote";
import { seedDraftStop, setDraftMode, submitDraft } from "@/trading/submit";
import { useTicketStore } from "@/trading/ticket";
import { useEffect, useState } from "react";
import { Close } from "../icons";
import PriceText from "./PriceText";

const field = "h-10 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm tabular-nums outline-none focus:border-[var(--accent)] disabled:opacity-40";
const cellField = "h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-2.5 text-[13px] tabular-nums outline-none focus:border-[var(--accent)] disabled:opacity-40";
const px = (v: number, digits: number) => v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Bảng đặt lệnh trong thanh bên phải (docs/trade-plan.md T3-T4), bố cục như TradingView: hai ô SELL / BUY giá lớn, Market hoặc Limit/Stop, lot, Take profit / Stop loss mỗi dòng có Giá + Điểm
 *  + Lãi/Lỗ theo tiền account (sửa ô nào hai ô kia tính lại), R:R và mức rủi ro. Entry / SL / TP của bản nháp hiện trên chart thành đường kéo được, kéo thì ô nhập đổi theo (và ngược lại). */
export default function OrderTicket() {
  const draft = useTicketStore((s) => s.draft);
  const id = useTicketStore((s) => s.id);
  return draft ? <TicketPanel key={id} d={draft} /> : <div className="px-4 py-6 text-sm text-[var(--muted)]">Bấm SELL / BUY trên chart để đặt lệnh.</div>;
}

// Ô nhập hiển thị giá trị TÍNH TỪ bản nháp; đang gõ thì giữ đúng chữ người dùng gõ (không bị làm tròn giữa chừng), rời ô thì quay về giá trị tính được.
function Cell({ title, value, onCommit, disabled, suffix, aria }: { title: string; value: string; onCommit: (v: string) => void; disabled?: boolean; suffix?: string; aria: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <div className="relative min-w-0">
      <input
        aria-label={aria}
        title={title}
        className={`${cellField} ${suffix ? "pr-9" : ""}`}
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
  );
}

/** Công tắc bật / tắt kiểu TV (thay ô tick). */
function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${on ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

const COLS = "grid grid-cols-[1.25fr_1fr_1fr] gap-1.5"; // ba ô Giá | Điểm | Lãi (Lỗ) của TP / SL và hàng nhãn cột phía trên thẳng cột với nhau

type StopProps = {
  kind: "sl" | "tp";
  d: Draft;
  entry: number; // giá vào dùng để đo điểm và lãi/lỗi
  lot: number;
  digits: number;
  tick: number;
  spec: PnlSpec | null;
  ccy: string;
};

// Take profit / Stop loss: bật tắt bằng ô tick, ba ô Giá | Điểm | Lãi (Lỗ) liên thông với nhau
function StopRow({ kind, d, entry, lot, digits, tick, spec, ccy }: StopProps) {
  const patch = useTicketStore.getState().patch;
  const value = parseNum(d[kind]);
  const on = d[kind].trim() !== "";
  const profit = kind === "tp";
  const set = (p: number | null) => patch({ [kind]: p !== null && p > 0 ? snapPrice(p, tick, digits).toFixed(digits) : "" });
  const toggle = (checked: boolean) => (checked ? seedDraftStop(kind) : patch({ [kind]: "" }));
  const valid = on && value > 0 && entry > 0;
  const points = valid ? String(pointsBetween(entry, value, digits)) : "";
  const amount = valid && spec ? Math.abs(estimatePnl(d.side, lot, entry, value, spec)).toFixed(2) : "";
  const name = profit ? "Take profit" : "Stop loss";
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-medium" style={{ color: profit ? "#089981" : "#ff9800" }}>
          {name}
        </span>
        <Switch on={on} onChange={toggle} label={`Enable ${name}`} />
      </div>
      <div className={COLS}>
        <Cell aria={`${name} price`} title="Giá" value={d[kind]} disabled={!on} onCommit={(v) => patch({ [kind]: v })} />
        <Cell aria={`${name} points`} title="Điểm" value={points} disabled={!on || !(entry > 0)} onCommit={(v) => (parseNum(v) > 0 ? set(priceFromPoints(entry, parseNum(v), kind, d.side, digits)) : null)} />
        <Cell
          aria={`${name} amount`}
          title={profit ? "Lãi dự kiến" : "Lỗ dự kiến"}
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
  const ccy = account?.currency ?? "";
  const pnl = pnlSpec(sym, ccy);
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
  // Lot ghi vào bản nháp (đã làm tròn theo step) và nhớ cho account × symbol: lần mở bảng sau và lệnh nhanh ở menu chuột phải dùng lot này
  const setLot = (v: number) => {
    if (!spec) return;
    patch({ lot: fmtLotValue(v, spec) });
    if (account) writeLot(account.id, d.symbol, v);
  };
  const sl = parseNum(d.sl);
  const tp = parseNum(d.tp);
  const bid = quote?.bid ?? 0;
  const ask = quote?.ask ?? 0;
  const type = !market && quote && price > 0 ? resolveOrderType(d.side, price, bid, ask) : null;
  const err = draftError(d, { sym, quote, account, status, loaded, nowSec: now });

  // Giá vào để đo điểm và lãi/lỗi: giá vào của lệnh chờ, hoặc giá khớp market (Buy mua ở Ask, Sell bán ở Bid)
  const entry = market ? (buy ? ask : bid) : price;

  // R:R và rủi ro (chỉ khi biết đủ để nói đúng)
  const reward = tp > 0 && entry > 0 ? Math.abs(tp - entry) : 0;
  const risk = sl > 0 && entry > 0 ? Math.abs(entry - sl) : 0;
  const lossAmount = pnl && sl > 0 && entry > 0 && lot > 0 ? Math.abs(estimatePnl(d.side, lot, entry, sl, pnl)) : null;
  const riskPct = lossAmount !== null && account?.equity && account.equity > 0 ? (lossAmount / account.equity) * 100 : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitDraft();
  };

  const accent = buy ? "#2962ff" : "#f23645";
  const lotLabel = spec && lot > 0 ? fmtLot(lot) : "";
  const submitTitle = market ? (buy ? "Buy" : "Sell") : type ? pendingLabel(type) : "Place order";
  const submitSub = `${lotLabel} ${d.symbol} @ ${market ? "market" : price > 0 ? px(price, digits) : "—"}`.trim();
  const lab = "mb-1.5 block text-xs text-[var(--muted)]";
  return (
    <form onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && close()} role="dialog" aria-label="Place order" className="flex min-h-0 flex-1 flex-col text-[var(--fg)]">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[15px] font-semibold">{d.symbol}</span>
          {account && MODE_LABEL[account.mode] && (
            <span className="rounded px-1.5 py-px text-[10px] font-bold text-white" style={{ background: MODE_COLOR[account.mode] }}>
              {MODE_LABEL[account.mode]}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]" title={account?.equity !== undefined ? `Equity ${fmtMoney(account.equity, account.currency)}` : undefined}>
            {account ? account.name || account.broker || account.server : "Chưa có account MT5"}
          </span>
          <button type="button" className="cursor-pointer rounded p-0.5 text-[var(--muted)] hover:bg-[var(--hover)]" onClick={close} aria-label="Close order panel">
            <Close size={20} />
          </button>
        </div>

        {/* Sell | Buy như TV: ô đang chọn tô màu, ô kia xám; chip spread (pip) nằm giữa */}
        <div className="relative mb-4 grid grid-cols-2 gap-1.5">
          {(["sell", "buy"] as const).map((s) => {
            const on = d.side === s;
            const sell = s === "sell";
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => patch({ side: s })}
                className={`flex h-[60px] cursor-pointer flex-col justify-center rounded-lg px-3.5 transition ${sell ? "items-start" : "items-end"} ${on ? "text-white" : "bg-[var(--hover)] text-[var(--fg)] hover:brightness-110"}`}
                style={on ? { background: sell ? "#f23645" : "#2962ff" } : undefined}
              >
                <span className={`text-xs font-medium leading-none ${on ? "text-white/80" : "text-[var(--muted)]"}`}>{sell ? "Sell" : "Buy"}</span>
                <span className="mt-1 text-[19px] font-semibold leading-none tabular-nums">{quote ? <PriceText value={sell ? bid : ask} digits={digits} /> : "—"}</span>
              </button>
            );
          })}
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-[11px] text-[var(--muted)] tabular-nums"
            data-testid="ticket-spread"
            title="Spread (pip)"
          >
            {quote ? spreadPips(bid, ask, digits) : "—"}
          </span>
        </div>

        <div className="mb-4 grid grid-cols-2 border-b border-[var(--border)] text-sm">
          {(["market", "pending"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={d.mode === m}
              onClick={() => setDraftMode(m)}
              className={`-mb-px h-10 cursor-pointer border-b-2 transition-colors ${d.mode === m ? "border-[var(--fg)] font-semibold" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"}`}
            >
              {m === "market" ? "Market" : "Limit / Stop"}
            </button>
          ))}
        </div>

        {!market && (
          <div className="mb-3">
            <label className={lab} htmlFor="ticket-entry">
              Giá vào
            </label>
            <div className="relative">
              <input
                id="ticket-entry"
                aria-label="Entry price"
                title={sym?.stops_level ? `Tối thiểu ${sym.stops_level} điểm so với giá thị trường` : undefined}
                className={`${field} pr-20`}
                inputMode="decimal"
                value={d.price}
                onChange={(e) => patch({ price: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold" style={{ color: accent }} data-testid="ticket-type">
                {type ? pendingLabel(type) : "—"}
              </span>
            </div>
          </div>
        )}

        <div className="mb-4">
          <span className={lab}>Lot</span>
          <div className="relative">
            <button type="button" aria-label="Decrease lot" disabled={!spec} className="absolute left-1 top-1 h-8 w-8 cursor-pointer rounded-md text-base text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-40" onClick={() => spec && setLot(stepLot(normalizeLot(lot, spec), -1, spec))}>
              −
            </button>
            <input aria-label="Lot" className={`${field} px-10 text-center`} inputMode="decimal" value={d.lot} onChange={(e) => patch({ lot: e.target.value })} onBlur={() => spec && setLot(normalizeLot(lot, spec))} onKeyDown={(e) => e.stopPropagation()} />
            <button type="button" aria-label="Increase lot" disabled={!spec} className="absolute right-1 top-1 h-8 w-8 cursor-pointer rounded-md text-base text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-40" onClick={() => spec && setLot(stepLot(normalizeLot(lot, spec), 1, spec))}>
              +
            </button>
          </div>
        </div>

        <div className="mb-2 text-xs font-semibold text-[var(--muted)]">Exits</div>
        <div className={`${COLS} mb-1 text-[10px] text-[var(--muted)]`} aria-hidden>
          <span>Giá</span>
          <span>Điểm</span>
          <span>Lãi / Lỗ</span>
        </div>
        <StopRow kind="tp" d={d} entry={entry} lot={lot} digits={digits} tick={tick} spec={pnl} ccy={ccy} />
        <StopRow kind="sl" d={d} entry={entry} lot={lot} digits={digits} tick={tick} spec={pnl} ccy={ccy} />

        {(reward > 0 && risk > 0) || lossAmount !== null ? (
          <div className="mb-3 space-y-1 rounded-lg bg-[var(--hover)] px-3 py-2 text-xs tabular-nums">
            {reward > 0 && risk > 0 && (
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Risk / Reward</span>
                <span>1 : {(reward / risk).toFixed(2)}</span>
              </div>
            )}
            {lossAmount !== null && (
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Rủi ro</span>
                <span>
                  {px(lossAmount, 2)} {ccy}
                  {riskPct !== null && ` (${riskPct.toFixed(2)}%)`}
                </span>
              </div>
            )}
          </div>
        ) : null}
        {(d.sl || d.tp) && !pnl && <div className="mb-3 text-[11px] text-[var(--muted)]">Symbol này cần EA ≥ 2.14 để tính lãi/lỗi</div>}

        {!market && (
          <div>
            <div className="flex items-center justify-between" title="Tắt = Good till cancelled">
              <span className="text-[13px] font-medium">Hết hạn</span>
              <Switch on={d.until} onChange={(v) => patch({ until: v })} label="Set expiration" />
            </div>
            {d.until && (
              <input
                aria-label="Expiration"
                type="datetime-local"
                value={d.untilText}
                onChange={(e) => patch({ untilText: e.target.value })}
                className={`${cellField} mt-1.5`}
              />
            )}
          </div>
        )}
      </div>

      {/* nút đặt lệnh dính ở đáy: luôn thấy dù bảng dài */}
      <div className="shrink-0 border-t border-[var(--border)] px-4 pb-3 pt-2">
        <div className="mb-1.5 min-h-[16px] truncate text-xs text-[#f23645]" role="alert" title={err ?? undefined}>
          {err}
        </div>
        <button type="submit" disabled={!!err || busy} className="flex h-12 w-full cursor-pointer flex-col items-center justify-center rounded-lg text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50" style={{ background: accent }}>
          <span className="text-sm font-semibold leading-tight">{submitTitle}</span>
          <span className="text-[11px] leading-tight text-white/80">{submitSub}</span>
        </button>
      </div>
    </form>
  );
}
