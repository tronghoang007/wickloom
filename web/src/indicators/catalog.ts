import { bigTrades } from "./defs/bigTrades";
import { kc, dc } from "./defs/channels";
import { cvd } from "./defs/cvd";
import { adx, ao, atr, cci, dmi, macd, mfi, mom, obv, roc, rsi, stoch, stochrsi, volume, willr } from "./defs/oscillators";
import { bb, ema, hma, smma, sma, vwap, vwma, wma } from "./defs/overlays";
import { pivots } from "./defs/pivots";
import { svp, vrvp } from "./defs/volumeProfile";
import { ichimoku, psar, supertrend } from "./defs/trend";
import type { IndicatorDef } from "./schema";

// Thứ tự = thứ tự hiện trong dialog Indicators.
export const INDICATORS: IndicatorDef[] = [
  sma, ema, wma, smma, vwma, hma, bb, kc, dc, ichimoku, psar, supertrend, pivots, vwap,
  volume, rsi, macd, stoch, stochrsi, atr, adx, dmi, cci, willr, ao, obv, mfi, mom, roc, cvd, svp, vrvp, bigTrades,
];

const BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));

export const findDef = (id: string): IndicatorDef | undefined => BY_ID.get(id);

/** Chỉ gọi với id đã qua migrate (instance hợp lệ). */
export const byId = (id: string): IndicatorDef => {
  const d = BY_ID.get(id);
  if (!d) throw new Error(`Indicator không tồn tại: ${id}`);
  return d;
};
