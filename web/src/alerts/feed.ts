import type { Alert, DeliveryResults } from "@/lib/alertsApi";

// Tin backend đẩy xuống kênh alert của /ws (sau khi gửi {action:"alerts"}). Tách khỏi React để kiểm tra được: tin sai hình dạng bị bỏ, không làm hỏng UI.

/** Tin không phải alert giá: nhắc tin kinh tế, SL / TP / lệnh chờ khớp (backend: notify.notice). */
export type Notice = { kind: "news" | "trade"; title: string; text: string; message: string; time: number; logId: number };

export type FeedEffects = {
  ready: () => void;
  denied: () => void;
  fired: (a: Alert, price: number, time: number, logId: number, late: boolean) => void;
  notice: (n: Notice) => void;
  delivery: (logId: number, results: DeliveryResults) => void;
  test: (text: string) => void;
};

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const isAlert = (v: unknown): v is Alert =>
  isRec(v) && typeof v.id === "string" && typeof v.symbol === "string" && isNum(v.level) && typeof v.cond === "string" && typeof v.state === "string" && isRec(v.channels);

export function handleFeedMessage(m: unknown, fx: FeedEffects): void {
  if (!isRec(m)) return;
  switch (m.type) {
    case "alerts_ready":
      return fx.ready();
    case "alerts_denied":
      return fx.denied();
    case "alert_fired":
      if (isAlert(m.alert) && isNum(m.price) && isNum(m.time) && isNum(m.log_id)) fx.fired(m.alert, m.price, m.time, m.log_id, m.late === true);
      return;
    case "alert_notice":
      if ((m.kind === "news" || m.kind === "trade") && typeof m.title === "string" && typeof m.text === "string" && isNum(m.time) && isNum(m.log_id))
        fx.notice({ kind: m.kind, title: m.title, text: m.text, message: typeof m.message === "string" ? m.message : "", time: m.time, logId: m.log_id });
      return;
    case "alert_delivery":
      if (isNum(m.log_id) && isRec(m.results)) fx.delivery(m.log_id, m.results as DeliveryResults);
      return;
    case "alert_test":
      return fx.test(typeof m.text === "string" ? m.text : "Tin thử");
  }
}
