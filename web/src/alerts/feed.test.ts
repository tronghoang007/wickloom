import { describe, expect, it, vi } from "vitest";
import { handleFeedMessage, type FeedEffects } from "./feed";

const alert = { id: "a", symbol: "XAUUSDm", cond: "cross", level: 4000, state: "triggered", channels: { web: true, telegram: false, mt5: false } };
const fx = (): FeedEffects => ({ ready: vi.fn(), denied: vi.fn(), fired: vi.fn(), delivery: vi.fn(), test: vi.fn() });

describe("handleFeedMessage", () => {
  it("routes the known messages", () => {
    const f = fx();
    handleFeedMessage({ type: "alerts_ready" }, f);
    handleFeedMessage({ type: "alerts_denied" }, f);
    handleFeedMessage({ type: "alert_fired", alert, price: 4001.5, time: 100, log_id: 7 }, f);
    handleFeedMessage({ type: "alert_delivery", log_id: 7, alert_id: "a", results: { telegram: "ok" } }, f);
    handleFeedMessage({ type: "alert_test", text: "hi" }, f);
    expect(f.ready).toHaveBeenCalledOnce();
    expect(f.denied).toHaveBeenCalledOnce();
    expect(f.fired).toHaveBeenCalledWith(alert, 4001.5, 100, 7);
    expect(f.delivery).toHaveBeenCalledWith(7, { telegram: "ok" });
    expect(f.test).toHaveBeenCalledWith("hi");
  });

  it("ignores malformed or unknown messages without throwing", () => {
    const f = fx();
    for (const m of [null, undefined, "x", 3, [], {}, { type: "bar_update" }, { type: "alert_fired" }, { type: "alert_fired", alert: { id: 1 }, price: 1, time: 1, log_id: 1 },
      { type: "alert_fired", alert, price: "1", time: 1, log_id: 1 }, { type: "alert_fired", alert, price: NaN, time: 1, log_id: 1 }, { type: "alert_delivery", log_id: 1 }])
      handleFeedMessage(m, f);
    expect(f.fired).not.toHaveBeenCalled();
    expect(f.delivery).not.toHaveBeenCalled();
    expect(f.ready).not.toHaveBeenCalled();
  });

  it("falls back to a default text for the test message", () => {
    const f = fx();
    handleFeedMessage({ type: "alert_test" }, f);
    expect(f.test).toHaveBeenCalledWith("Tin thử");
  });
});
