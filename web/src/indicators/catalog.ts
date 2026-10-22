import { bb, ema, sma, vwap, wma } from "./defs/overlays";
import { atr, macd, rsi, stoch, volume } from "./defs/oscillators";
import type { IndicatorDef } from "./schema";

// Thứ tự = thứ tự hiện trong dialog Indicators.
export const INDICATORS: IndicatorDef[] = [sma, ema, wma, bb, vwap, volume, rsi, macd, stoch, atr];

const BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));

export const findDef = (id: string): IndicatorDef | undefined => BY_ID.get(id);

/** Chỉ gọi với id đã qua migrate (instance hợp lệ). */
export const byId = (id: string): IndicatorDef => {
  const d = BY_ID.get(id);
  if (!d) throw new Error(`Indicator không tồn tại: ${id}`);
  return d;
};
