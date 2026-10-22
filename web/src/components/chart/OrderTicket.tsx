"use client";

import { fmtMoney, MODE_COLOR, MODE_LABEL } from "@/lib/mt5Format";
import { useAuthStore } from "@/store/auth";
import { chartGlobal } from "@/store/chart";
import { useMt5Store } from "@/store/mt5";
import { placePending, useOrderState } from "@/trading/actions";
import { fmtLot } from "@/trading/format";
import { tradeBlock } from "@/trading/gate";
import { currentLot, fmtLotValue, lotSpec, normalizeLot, stepLot } from "@/trading/lot";
import { pendingLabel, resolveOrderType, snapPrice, validatePending, type Side } from "@/trading/orderType";
import { useQuoteStore } from "@/trading/quote";
import { useTicketStore, type TicketSeed } from "@/trading/ticket";
import { useEffect, useState } from "react";
import { Close } from "../icons";

const input = "h-9 w-full rounded border border-[var(--border)] bg-transparent px-2 text-sm tabular-nums outline-none focus:border-[var(--accent)]";
const num = (t: string) => (t.trim() === "" ? 0 : parseFloat(t.replace(",", ".")));
const px = (v: number, digits: number) => v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Hộp thoại đặt lệnh chờ (docs/trade-plan.md T3): chọn hướng + giá vào, loại Limit/Stop tự suy ra từ giá thị trường và đổi theo từng tick. */
export default function OrderTicket() {
  const seed = useTicketStore((s) => s.seed);
  const id = useTicketStore((s) => s.id);
  return seed ? <TicketForm key={id} seed={seed} /> : null;
}

function TicketForm({ seed }: { seed: TicketSeed }) {
  const close = useTicketStore((s) => s.close);
  const sym = chartGlobal((s) => s.symbols.find((x) => x.name === seed.symbol));
  const quote = useQuoteStore((s) => s.quotes[seed.symbol]);
  const status = useAuthStore((s) => s.status);
  const loaded = useMt5Store((s) => s.loaded);
  const account = useMt5Store((s) => s.accounts.find((a) => a.active));
  const busy = useOrderState((s) => s.busy);
  const spec = lotSpec(sym, account?.max_lot);
  const digits = sym?.digits ?? 5;
  const tick = sym?.tick_size ?? 10 ** -digits;

  const [side, setSide] = useState<Side>(seed.side);
  const [priceText, setPriceText] = useState(seed.price.toFixed(digits));
  const [lotText, setLotText] = useState(spec ? fmtLotValue(currentLot(account?.id, seed.symbol, spec), spec) : "");
  const [slText, setSlText] = useState("");
  const [tpText, setTpText] = useState("");
  const [until, setUntil] = useState(false);
  const [untilText, setUntilText] = useState("");
  const [now, setNow] = useState(() => Date.now() / 1000); // để kiểm tra "hết hạn phải ở tương lai" mà không gọi Date.now() lúc render
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 10_000);
    return () => clearInterval(t);
  }, []);

  const price = num(priceText);
  const lot = num(lotText);
  const sl = num(slText);
  const tp = num(tpText);
  const expiration = until && untilText ? Math.floor(new Date(untilText).getTime() / 1000) : 0;
  const type = quote && price > 0 ? resolveOrderType(side, price, quote.bid, quote.ask) : null;
  const gate = tradeBlock({ replay: false, status, loaded, account, spec, hasQuote: !!quote });
  const err =
    gate ??
    validatePending({
      side, price, lot, sl, tp, expiration, bid: quote?.bid ?? 0, ask: quote?.ask ?? 0, digits, stopsLevel: sym?.stops_level, spec, nowSec: now,
    }) ??
    (until && !expiration ? "Chọn thời điểm hết hạn" : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (err || busy || !spec) return;
    const volume = normalizeLot(lot, spec);
    const ok = await placePending(
      { symbol: seed.symbol, side, volume, price: snapPrice(price, tick, digits), sl: sl > 0 ? snapPrice(sl, tick, digits) : 0, tp: tp > 0 ? snapPrice(tp, tick, digits) : 0, expiration, expectedType: type },
      digits,
    );
    if (ok) close();
  };

  const bumpPrice = (set: (v: string) => void, cur: number, dir: 1 | -1) => set(snapPrice((cur > 0 ? cur : price) + dir * tick * 10, tick, digits).toFixed(digits));
  const priceKeys = (set: (v: string) => void, cur: number) => (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      bumpPrice(set, cur, e.key === "ArrowUp" ? 1 : -1);
    }
  };

  const buy = side === "buy";
  const accent = buy ? "#2962ff" : "#f23645";
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <form onSubmit={submit} className="w-[400px] max-w-[94vw] rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-5 text-[var(--fg)] shadow-2xl" role="dialog" aria-label="Place order">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-lg font-semibold">{seed.symbol}</span>
          <button type="button" className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)]" onClick={close} aria-label="Close">
            <Close size={22} />
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

        <div className="mb-3 grid grid-cols-2 overflow-hidden rounded border border-[var(--border)] text-sm font-semibold">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={side === s}
              onClick={() => setSide(s)}
              className={`h-9 ${side === s ? "text-white" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}
              style={side === s ? { background: s === "buy" ? "#2962ff" : "#f23645" } : undefined}
            >
              {s === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-xs text-[var(--muted)]">
          Entry price
          <span className="ml-2 font-semibold" style={{ color: accent }} data-testid="ticket-type">
            {type ? pendingLabel(type) : "—"}
          </span>
        </label>
        <input aria-label="Entry price" className={input} inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)} onKeyDown={priceKeys(setPriceText, price)} autoFocus />
        <div className="mb-3 mt-1 text-[11px] text-[var(--muted)] tabular-nums">
          {quote ? `Bid ${px(quote.bid, digits)} · Ask ${px(quote.ask, digits)}${sym?.stops_level ? ` · tối thiểu ${sym.stops_level} điểm` : ""}` : "Chưa có giá thị trường"}
        </div>

        <div className="mb-3 grid grid-cols-3 gap-2">
          <div>
            <label className="mb-1 block text-xs text-[var(--muted)]">Lot</label>
            <div className="flex">
              <button type="button" aria-label="Decrease lot" disabled={!spec} className="h-9 w-7 rounded-l border border-r-0 border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-40" onClick={() => spec && setLotText(fmtLotValue(stepLot(normalizeLot(lot, spec), -1, spec), spec))}>
                −
              </button>
              <input aria-label="Lot" className={`${input} rounded-none px-1 text-center`} inputMode="decimal" value={lotText} onChange={(e) => setLotText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <button type="button" aria-label="Increase lot" disabled={!spec} className="h-9 w-7 rounded-r border border-l-0 border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-40" onClick={() => spec && setLotText(fmtLotValue(stepLot(normalizeLot(lot, spec), 1, spec), spec))}>
                +
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--muted)]">Stop loss</label>
            <input aria-label="Stop loss" className={input} inputMode="decimal" placeholder="—" value={slText} onChange={(e) => setSlText(e.target.value)} onKeyDown={priceKeys(setSlText, sl)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--muted)]">Take profit</label>
            <input aria-label="Take profit" className={input} inputMode="decimal" placeholder="—" value={tpText} onChange={(e) => setTpText(e.target.value)} onKeyDown={priceKeys(setTpText, tp)} />
          </div>
        </div>

        <div className="mb-1 flex items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <input type="checkbox" checked={until} onChange={(e) => setUntil(e.target.checked)} /> Hết hạn lúc
          </label>
          <input
            aria-label="Expiration"
            type="datetime-local"
            disabled={!until}
            value={untilText}
            onChange={(e) => setUntilText(e.target.value)}
            className="h-8 flex-1 rounded border border-[var(--border)] bg-transparent px-2 text-xs outline-none focus:border-[var(--accent)] disabled:opacity-40"
          />
        </div>
        <div className="mb-3 text-[11px] text-[var(--muted)]">{until ? "Theo giờ máy bạn" : "Good till cancelled"}</div>

        <div className="min-h-[18px] text-xs text-[#f23645]" role="alert">
          {err}
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="h-9 rounded border border-[var(--border)] px-4 text-sm hover:bg-[var(--hover)]" onClick={close}>
            Cancel
          </button>
          <button type="submit" disabled={!!err || busy} className="h-9 rounded px-4 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50" style={{ background: accent }}>
            {type ? `${pendingLabel(type)} ${spec && lot > 0 ? fmtLot(lot) : ""}`.trim() : "Place order"}
          </button>
        </div>
      </form>
    </div>
  );
}
