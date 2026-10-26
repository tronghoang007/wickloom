import { describe, expect, it } from "vitest";
import type { NewsRule, TradeRule } from "@/lib/alertsApi";
import { currencyChoices, leadLabel, newsSummary, ruleProblem, toggleCurrency, toggleLead } from "./rulesModel";

const CH = { web: true, telegram: false, mt5: false };
const news = (o: Partial<NewsRule> = {}): NewsRule => ({ enabled: true, leads: [15], min_importance: 3, currencies: [], channels: CH, ...o });
const trade = (o: Partial<TradeRule> = {}): TradeRule => ({ enabled: true, sl: true, tp: true, fill: true, channels: CH, ...o });

describe("toggleLead", () => {
  it("adds and removes marks and keeps them sorted, longest first", () => {
    expect(toggleLead([15], 60)).toEqual([60, 15]);
    expect(toggleLead([60, 15], 5)).toEqual([60, 15, 5]);
    expect(toggleLead([60, 15, 5], 15)).toEqual([60, 5]);
  });

  it("never leaves no mark and never exceeds three", () => {
    expect(toggleLead([15], 15)).toBeNull();
    expect(toggleLead([60, 30, 15], 5)).toBeNull();
  });
});

describe("currencies", () => {
  it("toggles a currency and keeps the list sorted", () => {
    expect(toggleCurrency([], "USD")).toEqual(["USD"]);
    expect(toggleCurrency(["USD"], "EUR")).toEqual(["EUR", "USD"]);
    expect(toggleCurrency(["EUR", "USD"], "EUR")).toEqual(["USD"]);
  });

  it("still shows a saved currency that is not in the fixed list", () => {
    expect(currencyChoices(["USD", "SEK"]).at(-1)).toBe("SEK");
    expect(currencyChoices(["USD"]).filter((c) => c === "USD")).toHaveLength(1);
  });
});

describe("labels", () => {
  it("formats lead marks and the one-line summary", () => {
    expect([1, 5, 60, 120, 90].map(leadLabel)).toEqual(["1 min", "5 min", "1 h", "2 h", "90 min"]);
    expect(newsSummary(news({ leads: [60, 5], currencies: ["EUR", "USD"] }))).toBe("High only · 1 h, 5 min · EUR, USD");
    expect(newsSummary(news({ min_importance: 1 }))).toBe("All events · 15 min · all currencies");
  });
});

describe("ruleProblem", () => {
  it("lets a disabled rule through whatever it holds", () => {
    expect(ruleProblem("news", news({ enabled: false, channels: { web: false, telegram: true, mt5: false } }), false)).toBeNull();
  });

  it("needs a channel, and a linked Telegram if Telegram is chosen", () => {
    expect(ruleProblem("news", news({ channels: { web: false, telegram: false, mt5: false } }), true)).toContain("kênh");
    expect(ruleProblem("news", news({ channels: { web: true, telegram: true, mt5: false } }), false)).toContain("Telegram");
    expect(ruleProblem("news", news({ channels: { web: true, telegram: true, mt5: false } }), null)).toBeNull(); // chưa biết: để backend quyết
    expect(ruleProblem("news", news(), true)).toBeNull();
  });

  it("needs at least one trading event type", () => {
    expect(ruleProblem("trade", trade({ sl: false, tp: false, fill: false }), true)).toContain("sự kiện");
    expect(ruleProblem("trade", trade({ sl: false }), true)).toBeNull();
  });
});
