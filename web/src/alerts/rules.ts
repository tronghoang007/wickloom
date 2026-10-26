import { fetchRules, patchRule, type Result, type Rules } from "@/lib/alertsApi";
import { create } from "zustand";

type State = {
  rules: Rules | null;
  error: string | null;
  load: () => Promise<void>;
  /** Đổi một phần quy tắc: hiện ngay, backend từ chối thì trả về như cũ (kèm lý do trong kết quả). */
  save: <K extends keyof Rules>(kind: K, patch: Partial<Rules[K]>) => Promise<Result<Rules[K]>>;
  reset: () => void;
};

export const useRulesStore = create<State>()((set, get) => ({
  rules: null,
  error: null,
  load: async () => {
    const r = await fetchRules();
    if (r.ok) set({ rules: r.data, error: null });
    else set({ error: r.error });
  },
  save: async (kind, patch) => {
    const before = get().rules;
    if (before) set({ rules: { ...before, [kind]: { ...before[kind], ...patch } } });
    const r = await patchRule(kind, patch);
    if (r.ok) set((s) => (s.rules ? { rules: { ...s.rules, [kind]: r.data } } : s));
    else if (before) set({ rules: before });
    return r;
  },
  reset: () => set({ rules: null, error: null }),
}));
