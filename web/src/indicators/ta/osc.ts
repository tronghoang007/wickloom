import type { Bar } from "@/lib/api";
import { isNa, type Num } from "./core";
import { rma } from "./ma";
import { change } from "./stat";

/** Pine ta.tr(handle_na): bar đầu = high − low (ta.atr dùng handle_na = true). */
export function trueRange(bars: Bar[]): Num {
  return bars.map((b, i) =>
    i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)),
  );
}

export const atr = (bars: Bar[], n: number): Num => rma(trueRange(bars), n);

/** Pine ta.rsi: RMA của phần tăng / phần giảm. */
export function rsi(a: Num, n: number): Num {
  const ch = change(a);
  const up = rma(ch.map((x) => (isNa(x) ? NaN : Math.max(x, 0))), n);
  const dn = rma(ch.map((x) => (isNa(x) ? NaN : Math.max(-x, 0))), n);
  return up.map((u, i) => (isNa(u) || isNa(dn[i]) ? NaN : dn[i] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / dn[i])));
}
