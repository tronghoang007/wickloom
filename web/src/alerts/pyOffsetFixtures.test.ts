import { byId } from "@/indicators/catalog";
import { computeInstance } from "@/indicators/engine";
import { newInstance, resolveInputs, type IndicatorInstance } from "@/indicators/instance";
import type { Bar } from "@/lib/api";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Offset của MA / Bollinger trong alert theo indicator: backend (indicators.shift) phải dịch đường đúng như chart (engine.ts shiftBy), cắt về đúng số nến (phần tương lai bỏ).
// Fixture riêng (backend/tests/fixtures/indicators_offset.json), cả vitest lẫn pytest (backend/tests/test_indicator_offset.py) cùng so với nó. Sinh lại:
//   WRITE_FIXTURES=1 npx vitest run src/alerts/pyOffsetFixtures.test.ts
const FILE = resolve(__dirname, "../../../backend/tests/fixtures/indicators_offset.json");

const bars: Bar[] = Array.from({ length: 300 }, (_, i) => {
  const c = 2000 + Math.sin(i / 7) * 10 + Math.cos(i * 1.1) * 2 + i * 0.1;
  return { t: 1_700_000_000 + i * 900, o: c - 0.5, h: c + 1 + (i % 4) * 0.3, l: c - 1 - (i % 3) * 0.2, c, v: 40 + ((i * 17) % 23) };
});

type Case = { id: string; inputs: IndicatorInstance["inputs"]; plots: string[] };
const CASES: Case[] = [
  { id: "sma", inputs: { offset: 3, smoothType: "SMA + Bollinger Bands", smoothLength: 5 }, plots: ["sma", "sm", "smUpper", "smLower"] }, // Smoothing không dịch theo Offset
  { id: "ema", inputs: { offset: -2, length: 12 }, plots: ["ema"] },
  { id: "wma", inputs: { offset: 5 }, plots: ["wma"] },
  { id: "bb", inputs: { offset: 2 }, plots: ["basis", "upper", "lower"] },
  { id: "bb", inputs: { offset: -4, maType: "EMA" }, plots: ["basis", "upper", "lower"] },
  { id: "sma", inputs: { offset: 900 }, plots: ["sma"] }, // ngoài [-500, 500]: kẹp về 500
];

type Enc = number | string | null;
const enc = (a: number[]): Enc[] => a.map((x) => (Number.isNaN(x) ? null : Number.isFinite(x) ? x : x > 0 ? "Infinity" : "-Infinity"));

function build() {
  return CASES.map((c) => {
    const def = byId(c.id);
    const out = computeInstance(def, { ...newInstance(c.id), inputs: c.inputs }, bars, { offset: 0 });
    // giá trị tại từng nến của chart (bỏ phần tương lai của Offset dương)
    return { id: c.id, given: c.inputs, resolved: resolveInputs(def, c.inputs), plots: Object.fromEntries(c.plots.map((p) => [p, enc(out[p].values.slice(0, bars.length))])) };
  });
}

describe("fixture Offset cho bản Python của indicator", () => {
  if (process.env.WRITE_FIXTURES) {
    it("ghi fixture", () => {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE, `${JSON.stringify({ bars, cases: build() })}\n`);
      expect(existsSync(FILE)).toBe(true);
    });
    return;
  }

  it("khớp với file đã ghi", () => {
    const fixture = JSON.parse(readFileSync(FILE, "utf8")) as { bars: Bar[]; cases: ReturnType<typeof build> };
    expect(fixture.bars).toEqual(bars);
    expect(fixture.cases).toEqual(JSON.parse(JSON.stringify(build())));
  });

  it("Offset dương lấy giá trị của nến trước, âm thì cuối chuỗi chưa có giá trị (như chart)", () => {
    const [sma, ema] = build();
    const raw = computeInstance(byId("sma"), { ...newInstance("sma"), inputs: { offset: 0, smoothType: "SMA + Bollinger Bands", smoothLength: 5 } }, bars, { offset: 0 });
    expect(sma.plots.sma[299]).toBe(raw.sma.values[296]);
    expect(sma.plots.sm).toEqual(enc(raw.sm.values)); // Smoothing không dịch
    expect(ema.plots.ema.slice(-2)).toEqual([null, null]);
  });
});
