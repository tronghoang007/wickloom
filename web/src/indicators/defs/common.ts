import type { CalendarOpts } from "../calendar";
import type { InputDef, Inputs, PlotData } from "../schema";
import { MA_TYPES, type Num, type SourceName } from "../ta";

export const sourceInput = (d: SourceName = "close"): InputDef => ({ key: "src", label: "Source", type: "source", default: d });
export const SRC = sourceInput();

export const length = (d: number, key = "length", label = "Length"): InputDef => ({ key, label, type: "int", default: d, min: 1 });

/** Hệ số nhớ vô hạn (EMA/RMA): cần ~k·n nến để ảnh hưởng của seed < 1e-4. */
export const warm = (k: number, ...ns: number[]) => Math.ceil(k * Math.max(...ns));

export const withColors = (values: Num, colors: string[]): PlotData => ({ values, colors });

/** Offset của MA: dịch plot theo số nến (dương = sang phải, vào vùng tương lai). */
export const offsetInput = (): InputDef => ({ key: "offset", label: "Offset", type: "int", default: 0, min: -500, max: 500 });

/** Chọn loại MA (SMA / EMA / SMMA / WMA / VWMA) như ô "Basis MA Type" / "Type" của TV. */
export const maTypeInput = (key = "maType", label = "MA Type", d = "SMA"): InputDef => ({ key, label, type: "select", default: d, options: [...MA_TYPES] });

/** Số nến cần trước nến đầu cho MA loại `type` (EMA / SMMA nhớ vô hạn nên cần thêm). */
export const maWarmup = (type: string, n: number): number => (type === "EMA" ? warm(4, n) : type === "SMMA (RMA)" ? warm(10, n) : n);

const SESSION_MIDNIGHT = "Broker midnight";
const SESSION_HOUR = "Custom hour";
const SESSION_BREAK = "After break";

/** Ba ô chọn mốc đổi phiên (CVD, Session Volume Profile): 00:00 broker như D1 của MT5, giờ tự đặt, hoặc nến đầu tiên sau giờ nghỉ của sản phẩm (vàng nghỉ 1 tiếng/ngày). */
export const sessionInputs = (): InputDef[] => [
  {
    key: "sessionStart", label: "Session start", hideInLegend: true, type: "select", default: SESSION_BREAK, options: [SESSION_MIDNIGHT, SESSION_HOUR, SESSION_BREAK],
    tooltip: "Where a new day/session begins. \"Broker midnight\" is 00:00 server time (the MetaTrader D1 candle). \"Custom hour\" starts it at a fixed server hour. \"After break\" starts it at the first candle after a gap with no candles (e.g. gold's daily 1-hour break, the weekend); with no break to find (crypto) it falls back to broker midnight. On H4 and above a session can only change on a candle boundary, so it usually equals broker midnight.",
  },
  { key: "sessionHour", label: "Start hour (broker time)", hideInLegend: true, type: "int", default: 0, min: 0, max: 23, enabledIf: (i) => i.sessionStart === SESSION_HOUR, tooltip: "Server time of the MetaTrader terminal, not your local time. Check the time axis of the D1 candle: it opens at 0." },
  { key: "sessionBreak", label: "Min break (minutes)", hideInLegend: true, type: "int", default: 30, min: 1, max: 720, enabledIf: (i) => i.sessionStart === SESSION_BREAK, tooltip: "A gap with no candles at least this long starts a new session. Gaps shorter than the chart candle are not visible." },
];

/** Lịch broker kèm mốc đổi phiên chọn trong `sessionInputs`. */
export function withSession(calendar: CalendarOpts, inputs: Inputs): CalendarOpts {
  if (inputs.sessionStart === SESSION_HOUR) return { ...calendar, session: { mode: "hour", hour: inputs.sessionHour as number } };
  if (inputs.sessionStart === SESSION_BREAK) return { ...calendar, session: { mode: "break", minutes: inputs.sessionBreak as number } };
  return calendar;
}
