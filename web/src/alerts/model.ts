import type { Alert, AlertChannels, AlertCond, AlertDrawing, AlertIndicator, AlertInput, AlertTrigger, ChannelsInfo, DeliveryResults } from "@/lib/alertsApi";
import { TF_SECONDS } from "@/lib/api";
import { parseNum } from "@/trading/draft";
import { defaultCondFor, spanText } from "./drawingSpec";
import { smoothingHint, vsText } from "./indicatorSpec";

// Phần thuần của alert (không React, không mạng): nhãn, form <-> API, kiểm tra nhập, mô tả.

export const COND_OPTIONS: { value: AlertCond; label: string }[] = [
  { value: "cross", label: "Crossing" },
  { value: "cross_up", label: "Crossing up" },
  { value: "cross_down", label: "Crossing down" },
  { value: "gt", label: "Greater than" },
  { value: "lt", label: "Less than" },
  // chỉ cho dải giá của kênh / hình chữ nhật
  { value: "enter", label: "Entering" },
  { value: "exit", label: "Exiting" },
  { value: "inside", label: "Inside" },
  { value: "outside", label: "Outside" },
];
export const TRIGGER_OPTIONS: { value: AlertTrigger; label: string }[] = [
  { value: "once", label: "Only once" },
  { value: "once_per_bar", label: "Once per bar" },
  { value: "once_per_bar_close", label: "Once per bar close" },
  { value: "every_time", label: "Every time" },
];
export const TRIGGER_HINT: Record<AlertTrigger, string> = {
  once: "Nổ một lần rồi tự dừng.",
  once_per_bar: "Nổ tối đa một lần trong mỗi nến.",
  once_per_bar_close: "Chỉ xét giá đóng nến, mỗi nến đóng tối đa một lần.",
  every_time: "Nổ mỗi lần điều kiện đúng, cách nhau tối thiểu 5 giây.",
};
export const EXPIRY_OPTIONS = [
  { value: "none", label: "No expiration" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "1 week" },
  { value: "30d", label: "1 month" },
  { value: "custom", label: "Custom…" },
] as const;
export type ExpiryChoice = (typeof EXPIRY_OPTIONS)[number]["value"];

/** Khung dùng cho "mỗi nến": chỉ những khung có độ dài cố định (MN1 backend không dựng được từ giây). */
export const ALERT_TFS = Object.keys(TF_SECONDS).filter((t) => t !== "MN1");

export const MAX_NAME = 60;
export const MAX_MESSAGE = 200;
export const needsTf = (t: AlertTrigger) => t === "once_per_bar" || t === "once_per_bar_close";

const condLabel = (c: AlertCond) => COND_OPTIONS.find((o) => o.value === c)?.label ?? c;
export const triggerLabel = (t: AlertTrigger) => TRIGGER_OPTIONS.find((o) => o.value === t)?.label ?? t;

export const fmtLevel = (v: number, digits = 2) => v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: Math.max(digits, 0) });

/** "XAUUSDm Crossing 4,000.50" - cùng chữ với tin Telegram / MT5 của backend. Alert theo indicator: "XAUUSDm RSI 14 close Crossing Up 70" / "... Crossing Signal" / "... Crossing price". */
export const describe = (a: { symbol: string; cond: AlertCond; level: number; drawing?: { label: string } | null; indicator?: Pick<AlertIndicator, "id" | "label" | "vs" | "vs_label"> | null }, digits = 5) =>
  a.indicator
    ? `${a.symbol} ${a.indicator.label} ${condLabel(a.cond)} ${a.indicator.vs === "level" ? fmtLevel(a.level, digits) : vsText(a.indicator)}`
    : `${a.symbol} ${condLabel(a.cond)} ${a.drawing ? a.drawing.label : fmtLevel(a.level, digits)}`;

/** Gợi ý cho ô "Trigger" của alert theo indicator: nổ theo nến đã đóng (không đổi nữa) hay theo nến đang chạy (có thể đổi trước khi đóng). */
export const indicatorTriggerHint = (t: AlertTrigger): string =>
  t === "once_per_bar_close"
    ? "Xét giá trị indicator của nến vừa đóng (không đổi nữa sau khi đóng), mỗi nến đóng tối đa một lần; nến đã đóng lúc backend / EA tắt được xét bù, gắn \"(trễ)\"."
    : `${TRIGGER_HINT[t]} Xét theo giá hiện tại: indicator của nến đang chạy có thể đổi trước khi nến đóng.`;

/** Chữ trên nhãn đường alert ở chart. */
export const lineTitle = (a: Pick<Alert, "name" | "state" | "cond">) => (a.name ? a.name : condLabel(a.cond)) + (a.state === "paused" ? " (paused)" : "");

export type AlertForm = {
  symbol: string;
  cond: AlertCond;
  level: string;
  trigger: AlertTrigger;
  tf: string;
  expiry: ExpiryChoice;
  expiresAt: string; // "YYYY-MM-DDTHH:mm" theo giờ máy, chỉ dùng khi expiry = custom
  name: string;
  message: string;
  channels: AlertChannels;
  drawing: AlertDrawing | null; // alert đi theo một hình vẽ: giá do hình quyết định, `level` chỉ là giá hiện tại của hình (hiển thị)
  indicator: AlertIndicator | null; // alert theo indicator: `level` chỉ dùng khi so với một mức (indicator.vs = "level")
};

export function defaultForm(symbol: string, price: number | null, tf: string, channels: AlertChannels, digits = 5, drawing: AlertDrawing | null = null, indicator: AlertIndicator | null = null): AlertForm {
  return {
    symbol,
    cond: defaultCondFor(drawing),
    level: price === null ? "" : String(Number(price.toFixed(digits))),
    trigger: indicator ? "once_per_bar_close" : "once", // TV cũng mặc định indicator xét khi đóng nến (không repaint)
    tf: drawing || ALERT_TFS.includes(tf) ? tf : "M1", // hình vẽ đánh giá trên đúng khung của chart tạo ra nó
    expiry: "none",
    expiresAt: "",
    name: "",
    message: "",
    channels: { ...channels },
    drawing,
    indicator,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function formFromAlert(a: Alert): AlertForm {
  return {
    symbol: a.symbol,
    cond: a.cond,
    level: String(a.level),
    trigger: a.trigger,
    tf: a.tf,
    expiry: a.expires_at === null ? "none" : "custom",
    expiresAt: a.expires_at === null ? "" : localInput(a.expires_at),
    name: a.name,
    message: a.message,
    channels: { ...a.channels },
    drawing: a.drawing,
    indicator: a.indicator,
  };
}

/** Hạn của form (epoch giây) tính từ `now`; null = không hạn; NaN = "custom" nhưng ô ngày giờ trống / sai. */
export function expiryOf(f: Pick<AlertForm, "expiry" | "expiresAt">, now: number): number | null {
  if (f.expiry === "none") return null;
  if (f.expiry === "custom") {
    const t = new Date(f.expiresAt).getTime();
    return Number.isFinite(t) ? Math.floor(t / 1000) : NaN;
  }
  return Math.floor(now) + parseInt(f.expiry, 10) * 86400;
}

export type FormCheck = { input: AlertInput | null; errors: Partial<Record<"symbol" | "level" | "name" | "message" | "expiry" | "channels" | "drawing" | "indicator", string>> };

/** Kiểm tra form trước khi gửi (backend vẫn kiểm lại). `known` = danh sách symbol của MT5 (rỗng = chưa tải, không chặn); `channelsInfo` null = chưa biết. */
export function checkForm(f: AlertForm, now: number, known: string[], channelsInfo: ChannelsInfo | null): FormCheck {
  const errors: FormCheck["errors"] = {};
  const symbol = f.symbol.trim();
  if (!symbol) errors.symbol = "Chọn symbol";
  else if (known.length > 0 && !known.includes(symbol)) errors.symbol = `${symbol} không có trên MT5`;
  let level = parseNum(f.level);
  if (f.drawing) {
    if (!Number.isFinite(level)) level = 0; // mức do hình quyết định; backend chỉ cần một số hữu hạn để hiển thị
    if (!ALERT_TFS.includes(f.tf)) errors.drawing = `Hình vẽ trên khung ${f.tf} chưa tạo được alert`;
  } else if (f.indicator && f.indicator.vs !== "level") {
    level = 0; // so với giá / đường khác: `level` không dùng, backend chỉ cần một số hữu hạn
  } else if (!f.level.trim() || !Number.isFinite(level)) errors.level = "Nhập giá";
  else if (Math.abs(level) >= 1e12) errors.level = "Giá quá lớn";
  if (f.indicator) {
    if (!ALERT_TFS.includes(f.tf)) errors.indicator = `Khung ${f.tf} chưa tạo được alert theo indicator`;
    else {
      const hint = smoothingHint(f.indicator);
      if (hint) errors.indicator = hint;
    }
  }
  if (f.name.trim().length > MAX_NAME) errors.name = `Tên tối đa ${MAX_NAME} ký tự`;
  if (f.message.trim().length > MAX_MESSAGE) errors.message = `Nội dung tối đa ${MAX_MESSAGE} ký tự`;
  const exp = expiryOf(f, now);
  if (exp !== null && (!Number.isFinite(exp) || exp <= now)) errors.expiry = Number.isFinite(exp) ? "Hạn phải ở tương lai" : "Chọn ngày giờ hết hạn";
  if (!f.channels.web && !f.channels.telegram && !f.channels.mt5) errors.channels = "Chọn ít nhất một kênh";
  else if (f.channels.telegram && channelsInfo && !channelsInfo.telegram.linked) errors.channels = "Chưa kết nối Telegram (Settings → Alerts)";
  if (Object.keys(errors).length > 0) return { input: null, errors };
  return {
    errors,
    input: { symbol, cond: f.cond, level, trigger: f.trigger, tf: f.tf, expires_at: exp, name: f.name.trim(), message: f.message.trim(), channels: f.channels, ...(f.drawing ? { drawing: f.drawing } : {}), ...(f.indicator ? { indicator: f.indicator } : {}) },
  };
}

/** Số alert đang chạy hoặc tạm dừng (backend giới hạn 100 mỗi tài khoản). */
export const liveCount = (alerts: Alert[]) => alerts.filter((a) => a.state === "active" || a.state === "paused").length;
export const MAX_LIVE = 100;

/** Kênh nào của lần nổ này giao lỗi (bỏ "web: không có tab mở": không phải lỗi). */
export function failedChannels(r: DeliveryResults): { kind: keyof DeliveryResults; reason: string }[] {
  return (Object.entries(r) as [keyof DeliveryResults, string][])
    .filter(([k, v]) => v !== "ok" && !(k === "web" && v.startsWith("không có tab")))
    .map(([kind, reason]) => ({ kind, reason }));
}

export const CHANNEL_NAME = { web: "Web", telegram: "Telegram", mt5: "MT5 mobile" } as const;

/** Alert sắp xếp để hiển thị: đang chạy / tạm dừng trước (mới tạo trên cùng), rồi đã nổ / hết hạn (mới nổ trên cùng). */
export function sortAlerts(list: Alert[]): Alert[] {
  const live = (a: Alert) => a.state === "active" || a.state === "paused";
  return [...list].sort((a, b) => (live(a) === live(b) ? (live(a) ? b.created_at - a.created_at : (b.fired_at ?? b.created_at) - (a.fired_at ?? a.created_at)) : live(a) ? -1 : 1));
}

/** Giá của alert để vẽ đường trên chart của `symbol`: chỉ alert đang chạy / tạm dừng của symbol đó và có `on_chart` (alert khác chỉ nằm trong danh sách). */
export const lineAlerts = (alerts: Alert[], symbol: string) => alerts.filter((a) => a.symbol === symbol && !a.drawing && !a.indicator && a.on_chart && (a.state === "active" || a.state === "paused"));

/** Tiêu đề + nội dung của toast / thông báo trình duyệt khi alert nổ. `now` = mức / dải giá của hình lúc nổ (alert trên hình vẽ); `late` = báo bù (giá chạm lúc backend / EA tắt). */
export function fireNotice(a: Pick<Alert, "name" | "symbol" | "cond" | "level" | "message" | "drawing" | "indicator"> & { now?: [number, number] }, price: number, digits: number, late = false): { title: string; text: string } {
  const where = a.drawing && a.now ? ` (${spanText(a.now[0], a.now[1], (v) => fmtLevel(v, digits))})` : a.indicator && a.now ? ` (${fmtLevel(a.now[0], 4)})` : ""; // đường indicator: giá trị của nó lúc nổ
  const text = `${late ? "(trễ) " : ""}${describe(a, digits)}${where} (price ${fmtLevel(price, digits)})`;
  return { title: a.name || a.symbol, text: a.message ? `${text} — ${a.message}` : text };
}
