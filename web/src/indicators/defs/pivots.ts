import type { Bar } from "@/lib/api";
import { periodKeys, type Period } from "../calendar";
import { ObjectBuilder } from "../objects";
import { num, str, type IndicatorDef } from "../schema";
import { length } from "./common";

// Pivot Points Standard: từ H/L/C (và O) của kỳ TRƯỚC tính các mức, vẽ ngang suốt kỳ HIỆN TẠI. Kỳ theo giờ broker.

export const PIVOT_TYPES = ["Traditional", "Fibonacci", "Woodie", "Classic", "DM", "Camarilla"] as const;
export const PIVOT_FRAMES = ["Auto", "Daily", "Weekly", "Monthly", "Yearly"] as const;
const PERIOD_OF: Record<string, Period> = { Daily: "day", Weekly: "week", Monthly: "month", Yearly: "year" };

/** OHLC của một kỳ (O = mở nến đầu, C = đóng nến cuối). */
export type Ohlc = { o: number; h: number; l: number; c: number };
export type Level = { name: string; price: number };

/** Các mức của kỳ kế tiếp tính từ OHLC của kỳ trước. `o` của kỳ hiện tại chỉ Woodie cần. Thứ tự: P, R1.., S1.. */
export function pivotLevels(type: string, p: Ohlc, curOpen: number): Level[] {
  const { o, h, l, c } = p;
  const r = h - l;
  const pp = (h + l + c) / 3;
  const rs = (res: number[], sup: number[]): Level[] => [
    { name: "P", price: pp },
    ...res.map((price, i) => ({ name: `R${i + 1}`, price })),
    ...sup.map((price, i) => ({ name: `S${i + 1}`, price })),
  ];
  switch (type) {
    case "Fibonacci":
      return rs([pp + 0.382 * r, pp + 0.618 * r, pp + r], [pp - 0.382 * r, pp - 0.618 * r, pp - r]);
    case "Woodie": {
      const w = (h + l + 2 * curOpen) / 4;
      const r3 = h + 2 * (w - l), s3 = l - 2 * (h - w);
      return [
        { name: "P", price: w },
        ...[2 * w - l, w + r, r3, r3 + r].map((price, i) => ({ name: `R${i + 1}`, price })),
        ...[2 * w - h, w - r, s3, s3 - r].map((price, i) => ({ name: `S${i + 1}`, price })),
      ];
    }
    case "Classic":
      return rs([2 * pp - l, pp + r, pp + 2 * r, pp + 3 * r], [2 * pp - h, pp - r, pp - 2 * r, pp - 3 * r]);
    case "DM": {
      const x = o === c ? h + l + 2 * c : c > o ? 2 * h + l + c : h + 2 * l + c;
      return [{ name: "P", price: x / 4 }, { name: "R1", price: x / 2 - l }, { name: "S1", price: x / 2 - h }];
    }
    case "Camarilla": {
      const k = 1.1 * r;
      const r5 = (h / l) * c;
      return rs([c + k / 12, c + k / 6, c + k / 4, c + k / 2, r5], [c - k / 12, c - k / 6, c - k / 4, c - k / 2, c - (r5 - c)]);
    }
    default: // Traditional
      return rs([2 * pp - l, pp + r, 2 * pp + (h - 2 * l), 3 * pp + (h - 3 * l), 4 * pp + (h - 4 * l)], [2 * pp - h, pp - r, 2 * pp - (2 * h - l), 3 * pp - (3 * h - l), 4 * pp - (4 * h - l)]);
  }
}

/** Kỳ khi chọn Auto theo khung của chart (suy từ bước nến): ≤15 phút → ngày, trong ngày → tuần, ngày → tháng, tuần trở lên → năm. */
export function autoPeriod(step: number): Period {
  if (step <= 15 * 60) return "day";
  if (step < 86400) return "week";
  if (step < 7 * 86400) return "month";
  return "year";
}

/** Bước nến (giây) = trung vị khoảng cách giữa các nến gần đây (bỏ khoảng nghỉ cuối tuần). */
export function barStep(bars: Bar[]): number {
  const d: number[] = [];
  for (let i = Math.max(1, bars.length - 200); i < bars.length; i++) d.push(bars[i].t - bars[i - 1].t);
  if (d.length === 0) return 60;
  return d.sort((a, b) => a - b)[d.length >> 1];
}

/** Gom nến theo kỳ: mỗi kỳ có chỉ số nến đầu/cuối và OHLC. */
export type PeriodBar = Ohlc & { first: number; last: number };
export function groupPeriods(bars: Bar[], keys: number[]): PeriodBar[] {
  const out: PeriodBar[] = [];
  bars.forEach((b, i) => {
    const cur = out[out.length - 1];
    if (cur && keys[i] === keys[i - 1]) {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.last = i;
    } else out.push({ o: b.o, h: b.h, l: b.l, c: b.c, first: i, last: i });
  });
  return out;
}

/** Số chữ số thập phân của giá (suy từ các giá đóng cửa gần đây, tối đa 8) để in nhãn giá. */
export function decimalsOf(bars: Bar[]): number {
  let d = 0;
  for (const b of bars.slice(-50)) {
    const s = String(b.c);
    const dot = s.indexOf(".");
    if (dot >= 0) d = Math.max(d, Math.min(8, s.length - dot - 1));
  }
  return d;
}

const COLORS = { P: "#fb8c00", R: "#f23645", S: "#089981" };
const colorOf = (name: string) => COLORS[name[0] as "P" | "R" | "S"];

export const pivots: IndicatorDef = {
  id: "pivots", name: "Pivots", title: "Pivot points standard", overlay: true,
  inputs: [
    { key: "type", label: "Type", type: "select", default: "Traditional", options: [...PIVOT_TYPES] },
    { key: "frame", label: "Pivots Timeframe", type: "select", default: "Auto", options: [...PIVOT_FRAMES] },
    length(15, "back", "Number of Pivots Back"),
    { key: "labels", label: "Show Labels", type: "bool", default: true },
    { key: "labelsPos", label: "Labels Position", type: "select", default: "Left", options: ["Left", "Right"] },
    { key: "prices", label: "Show Prices", type: "bool", default: true },
    { key: "width", label: "Line Width", type: "int", default: 1, min: 1, max: 4 },
  ],
  plots: [],
  needsCalendar: true,
  warmup: () => 0,
  compute: () => ({}),
  objects: ({ bars, inputs, calendar }) => {
    const out = new ObjectBuilder();
    if (bars.length < 2) return out.set;
    const frame = str(inputs, "frame");
    const period = PERIOD_OF[frame] ?? autoPeriod(barStep(bars));
    const periods = groupPeriods(bars, periodKeys(bars.map((b) => b.t), period, calendar));
    const dec = decimalsOf(bars);
    const width = num(inputs, "width");
    const back = num(inputs, "back");
    // Kỳ đầu của lịch sử đã nạp có thể bị cắt dở nên không dùng làm gốc tính; kỳ cuối (đang chạy) kéo dài sang phải
    for (let k = Math.max(2, periods.length - back); k < periods.length; k++) {
      const prev = periods[k - 1], cur = periods[k];
      const isLast = k === periods.length - 1;
      for (const lv of pivotLevels(str(inputs, "type"), prev, cur.o)) {
        if (!Number.isFinite(lv.price)) continue;
        const color = colorOf(lv.name);
        out.line({ x1: cur.first, y1: lv.price, x2: cur.last, y2: lv.price, color, width, extend: isLast ? "right" : "none" });
        if (!inputs.labels) continue;
        const text = inputs.prices ? `${lv.name} ${lv.price.toFixed(dec)}` : lv.name;
        const left = str(inputs, "labelsPos") === "Left";
        out.label({ x: left ? cur.first : cur.last, y: lv.price, text, color, style: left ? "right" : "left", size: "small" });
      }
    }
    return out.set;
  },
};
