import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rules } from "@/lib/alertsApi";

const api = vi.hoisted(() => ({ fetchRules: vi.fn(), patchRule: vi.fn() }));
vi.mock("@/lib/alertsApi", () => api);

import { useRulesStore } from "./rules";

const CH = { web: true, telegram: false, mt5: false };
const rules = (): Rules => ({
  news: { enabled: false, leads: [15], min_importance: 3, currencies: [], channels: CH },
  trade: { enabled: false, sl: true, tp: true, fill: true, channels: CH },
});

beforeEach(() => {
  api.fetchRules.mockReset();
  api.patchRule.mockReset();
  useRulesStore.getState().reset();
});

describe("useRulesStore", () => {
  it("loads the rules, or keeps the error", async () => {
    api.fetchRules.mockResolvedValueOnce({ ok: true, data: rules() });
    await useRulesStore.getState().load();
    expect(useRulesStore.getState().rules?.news.leads).toEqual([15]);
    api.fetchRules.mockResolvedValueOnce({ ok: false, error: "x" });
    await useRulesStore.getState().load();
    expect(useRulesStore.getState().error).toBe("x");
    expect(useRulesStore.getState().rules).not.toBeNull(); // lỗi tải lại không xoá bản đang có
  });

  it("shows a change at once and keeps what the backend returns", async () => {
    api.fetchRules.mockResolvedValue({ ok: true, data: rules() });
    await useRulesStore.getState().load();
    let seen: boolean | undefined;
    api.patchRule.mockImplementation(async () => {
      seen = useRulesStore.getState().rules?.trade.enabled; // trong lúc chờ backend
      return { ok: true, data: { ...rules().trade, enabled: true, tp: false } };
    });
    const r = await useRulesStore.getState().save("trade", { enabled: true });
    expect(r.ok).toBe(true);
    expect(seen).toBe(true);
    expect(useRulesStore.getState().rules?.trade).toMatchObject({ enabled: true, tp: false });
    expect(api.patchRule).toHaveBeenCalledWith("trade", { enabled: true });
  });

  it("puts the old value back when the backend refuses", async () => {
    api.fetchRules.mockResolvedValue({ ok: true, data: rules() });
    await useRulesStore.getState().load();
    api.patchRule.mockResolvedValue({ ok: false, error: "Chưa kết nối Telegram" });
    const r = await useRulesStore.getState().save("news", { enabled: true });
    expect(r).toEqual({ ok: false, error: "Chưa kết nối Telegram" });
    expect(useRulesStore.getState().rules?.news.enabled).toBe(false);
  });
});
