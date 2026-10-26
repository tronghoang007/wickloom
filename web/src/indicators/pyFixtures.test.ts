import type { Bar } from "@/lib/api";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { byId } from "./catalog";
import { computeInstance } from "./engine";
import { ALERT_PLOTS } from "@/alerts/indicatorSpec";
import { newInstance, resolveInputs, type IndicatorInstance } from "./instance";

// Alert theo indicator chạy ở backend bằng bản Python của vài indicator (backend/app/indicators.py). Hai bên phải ra CÙNG số: file fixture này do TypeScript sinh ra và cả vitest lẫn pytest
// (backend/tests/test_indicators.py) so với nó. Đổi công thức ở đâu thì bên đó vỡ, rồi sinh lại fixture để bên kia vỡ theo:
//   WRITE_FIXTURES=1 npx vitest run src/indicators/pyFixtures.test.ts
const FILE = resolve(__dirname, "../../../backend/tests/fixtures/indicators.json");

// Chuỗi M15 xác định: xu hướng + sóng + nhiễu, volume khác nhau; một đoạn volume 0 để thử chia cho 0 của VWMA (0 / 0 = NaN như JavaScript).
const bars: Bar[] = Array.from({ length: 400 }, (_, i) => {
  const c = 2000 + Math.sin(i / 6) * 12 + Math.cos(i * 1.3) * 2 + i * 0.15;
  return { t: 1_700_000_000 + i * 900, o: c - 0.6 + (i % 3) * 0.3, h: c + 1.2 + (i % 4) * 0.4, l: c - 1.1 - (i % 3) * 0.3, c, v: i >= 200 && i < 240 ? 0 : 50 + ((i * 29) % 41) };
});

type Case = { id: string; inputs: IndicatorInstance["inputs"]; plots: string[] };
const SMOOTH = ["sm", "smUpper", "smLower"];
const CASES: Case[] = [
  { id: "sma", inputs: {}, plots: ["sma", ...SMOOTH] },
  { id: "sma", inputs: { length: 20, src: "hl2", smoothType: "SMA + Bollinger Bands", smoothLength: 10, smoothMult: 1.5 }, plots: ["sma", ...SMOOTH] },
  { id: "sma", inputs: { length: 5, smoothType: "WMA", smoothLength: 8 }, plots: ["sma", ...SMOOTH] },
  { id: "ema", inputs: {}, plots: ["ema", ...SMOOTH] },
  { id: "ema", inputs: { length: 21, smoothType: "EMA", smoothLength: 5 }, plots: ["ema", ...SMOOTH] },
  { id: "ema", inputs: { length: 50, src: "ohlc4", smoothType: "VWMA", smoothLength: 7 }, plots: ["ema", ...SMOOTH] },
  { id: "wma", inputs: {}, plots: ["wma"] },
  { id: "wma", inputs: { length: 14, src: "hlcc4" }, plots: ["wma"] },
  { id: "rsi", inputs: {}, plots: ["rsi", ...SMOOTH] },
  { id: "rsi", inputs: { length: 7, src: "hlc3", smoothType: "SMMA (RMA)", smoothLength: 9 }, plots: ["rsi", ...SMOOTH] },
  { id: "rsi", inputs: { length: 21, smoothType: "SMA + Bollinger Bands" }, plots: ["rsi", ...SMOOTH] },
  { id: "macd", inputs: {}, plots: ["macd", "signal", "hist"] },
  { id: "macd", inputs: { fast: 5, slow: 13, signal: 4, oscMa: "SMA", signalMa: "SMA", src: "low" }, plots: ["macd", "signal", "hist"] },
  { id: "bb", inputs: {}, plots: ["basis", "upper", "lower"] },
  { id: "bb", inputs: { length: 14, maType: "EMA", mult: 1.5, src: "hl2" }, plots: ["basis", "upper", "lower"] },
  { id: "bb", inputs: { maType: "VWMA" }, plots: ["basis", "upper", "lower"] },
  { id: "bb", inputs: { length: 30, maType: "SMMA (RMA)" }, plots: ["basis", "upper", "lower"] },
  { id: "stoch", inputs: {}, plots: ["k", "d"] },
  { id: "stoch", inputs: { k: 9, smooth: 3, d: 5 }, plots: ["k", "d"] },
  // đầu vào hỏng: làm tròn, chặn min, giá trị lạ -> mặc định
  { id: "rsi", inputs: { length: 12.5, smoothLength: 0, src: "nope", smoothType: "bogus" }, plots: ["rsi", ...SMOOTH] },
];

// JSON không có NaN / Infinity: NaN là null, ±Infinity là chuỗi (VWMA chia cho tổng volume 0 ra Infinity do số dư của tổng trượt, Python phải ra đúng như vậy).
type Enc = number | string | null;
const enc = (a: number[]): Enc[] => a.map((x) => (Number.isNaN(x) ? null : Number.isFinite(x) ? x : x > 0 ? "Infinity" : "-Infinity"));
const dec = (x: Enc): number => (x === null ? NaN : typeof x === "string" ? Number(x) : x);

function build() {
  return CASES.map((c) => {
    const def = byId(c.id);
    const out = computeInstance(def, { ...newInstance(c.id), inputs: c.inputs }, bars, { offset: 0 });
    return {
      id: c.id,
      given: c.inputs,
      resolved: resolveInputs(def, c.inputs),
      warmup: def.warmup(resolveInputs(def, c.inputs)),
      plots: Object.fromEntries(c.plots.map((p) => [p, enc(out[p].values)])),
    };
  });
}

describe("fixture cho bản Python của indicator", () => {
  if (process.env.WRITE_FIXTURES) {
    it("ghi fixture", () => {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE, `${JSON.stringify({ bars, cases: build() })}\n`);
      expect(existsSync(FILE)).toBe(true);
    });
    return;
  }

  it("mọi đường đặt alert được của mọi indicator đều có trong fixture (nên bản Python cũng được kiểm)", () => {
    const covered: Record<string, Set<string>> = {};
    for (const c of CASES) for (const p of c.plots) (covered[c.id] ??= new Set()).add(p);
    for (const [id, plots] of Object.entries(ALERT_PLOTS)) expect([...(covered[id] ?? [])].sort(), id).toEqual([...plots].sort());
    expect(Object.keys(covered).sort()).toEqual(Object.keys(ALERT_PLOTS).sort());
  });

  it("khớp với file đã ghi (đổi công thức TypeScript thì sinh lại fixture, rồi pytest sẽ báo bản Python lệch)", () => {
    const fixture = JSON.parse(readFileSync(FILE, "utf8")) as { bars: Bar[]; cases: ReturnType<typeof build> };
    expect(fixture.bars).toEqual(bars);
    const now = build();
    expect(fixture.cases).toHaveLength(now.length);
    now.forEach((c, k) => {
      const f = fixture.cases[k];
      expect(f.id).toBe(c.id);
      expect(f.resolved).toEqual(c.resolved);
      expect(f.warmup).toBe(c.warmup);
      for (const [p, values] of Object.entries(c.plots)) {
        expect(f.plots[p], `${c.id}.${p}`).toHaveLength(values.length);
        values.forEach((v, i) => {
          const want = dec(v), got = dec(f.plots[p][i]);
          const at = `${c.id}.${p}[${i}]`;
          if (Number.isFinite(want)) expect(got, at).toBeCloseTo(want, 9);
          else expect(got, at).toBe(want); // NaN khớp NaN, Infinity khớp đúng dấu (toBe dùng Object.is)
        });
      }
    });
  });
});
