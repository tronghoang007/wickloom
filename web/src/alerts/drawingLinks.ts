import { onDocChanged, type DrawingDoc } from "@/drawings/doc";
import type { Drawing } from "@/drawings/types";
import type { Alert, AlertDrawing } from "@/lib/alertsApi";
import { useAuthStore } from "@/store/auth";
import { askConfirm } from "@/store/confirm";
import { toast } from "@/store/toast";
import { geometrySig, specFromDrawing } from "./drawingSpec";
import { useAlertStore } from "./store";

// Giữ alert đi theo hình vẽ khớp với hình (docs/alerts-plan.md Phase 2): backend chỉ giữ BẢN SAO toạ độ, nên khi hình bị kéo / sửa web gửi bản sao mới, khi hình bị xoá thì hỏi có xoá alert không.

const SETTLE_MS = 600; // kéo hình liên tục: chỉ gửi khi dừng

export type LinkPlan = { patch: { alert: Alert; spec: AlertDrawing }[]; gone: Alert[] };
export type DocLike = { symbol: string | null; layoutId: string; drawings: Drawing[] };

/** Alert nào cần cập nhật toạ độ, alert nào mất hình. Chỉ xét alert đang chạy / tạm dừng còn liên kết, cùng symbol và cùng layout với doc: hình ở layout khác không hiện trong doc này
 *  nên không được coi là đã bị xoá. */
export function planLinks(alerts: Alert[], doc: DocLike): LinkPlan {
  const plan: LinkPlan = { patch: [], gone: [] };
  for (const a of alerts) {
    const link = a.drawing;
    if (!link?.id || link.layout !== doc.layoutId || a.symbol !== doc.symbol || (a.state !== "active" && a.state !== "paused")) continue;
    const d = doc.drawings.find((x) => x.id === link.id);
    if (!d) {
      plan.gone.push(a);
      continue;
    }
    const spec = specFromDrawing(d, { layout: link.layout, log: link.log });
    if (spec && geometrySig(spec) !== geometrySig(link)) plan.patch.push({ alert: a, spec });
  }
  return plan;
}

const asked = new Set<string>(); // alert đã hỏi (hoặc đang hỏi) "xoá luôn alert?": không hỏi lại trong phiên này
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function apply(doc: DrawingDoc) {
  if (!doc.ready || useAuthStore.getState().status !== "user" || !doc.symbol) return;
  const store = useAlertStore.getState();
  const plan = planLinks(store.alerts, doc);
  for (const { alert, spec } of plan.patch) {
    void store.update(alert.id, { drawing: spec }, { drawing: spec }).then((r) => {
      if (!r.ok) toast(r.error, { title: "Không cập nhật được alert theo hình vẽ", kind: "error" });
    });
  }
  for (const a of plan.gone) {
    if (asked.has(a.id)) continue;
    asked.add(a.id);
    const keep = () => useAlertStore.getState().update(a.id, { unlink: true }); // giữ alert: chạy tiếp với toạ độ cuối của hình
    askConfirm({
      title: "Delete alert too?",
      message: `Hình "${a.drawing?.label}" đã bị xoá. Xoá luôn alert của nó (${a.name || a.symbol}), hay giữ alert chạy tiếp với toạ độ cuối của hình?`,
      confirmLabel: "Delete alert",
      cancelLabel: "Keep alert",
      danger: true,
      onConfirm: async () => {
        const r = await useAlertStore.getState().remove(a.id);
        if (!r.ok) toast(r.error, { kind: "error" });
      },
      onCancel: () => void keep(),
    });
  }
}

/** Bắt đầu theo dõi hình vẽ của mọi doc; trả hàm dừng. */
export function startDrawingLinks(): () => void {
  const off = onDocChanged((doc) => {
    const key = `${doc.layoutId}|${doc.symbol}`;
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => apply(doc), SETTLE_MS));
  });
  return () => {
    off();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}
