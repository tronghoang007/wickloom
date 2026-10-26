import { apiFetch, errorMessage } from "./api";

// Alert giá (docs/alerts-plan.md). Backend so điều kiện trên tick của EA nên alert nổ cả khi tắt tab; mọi lời gọi cần đăng nhập.

// enter / exit / inside / outside chỉ cho dải giá của kênh và hình chữ nhật
export type AlertCond = "cross" | "cross_up" | "cross_down" | "gt" | "lt" | "enter" | "exit" | "inside" | "outside";
export type AlertTrigger = "once" | "once_per_bar" | "once_per_bar_close" | "every_time";
export type AlertState = "active" | "paused" | "triggered" | "expired";
export type AlertChannels = { web: boolean; telegram: boolean; mt5: boolean };
export type ChannelKind = keyof AlertChannels;

/** Bản sao hình vẽ mà alert đi theo (backend chỉ đọc bản sao này, không đọc layout lúc đánh giá). `id` null = hình đã bị xoá nhưng alert được giữ. */
export type AlertDrawing = {
  id: string | null;
  layout: string; // layout chứa hình: chỉ doc của layout đó được cập nhật / xoá alert
  type: string; // loại công cụ vẽ (trendline, ray, channel, rect...)
  label: string; // tên hiển thị ("Trendline")
  pts: [number, number][]; // [giây UTC, giá] của các điểm neo
  ext: "none" | "left" | "right" | "both";
  log: boolean; // chart đang ở thang log lúc tạo: đường thẳng theo ln giá
};

/** Alert theo indicator (docs/alerts-plan.md Phase 3): so một đường của indicator với mức giá, giá, hoặc một đường khác của cùng indicator. Backend tính bằng bản Python của indicator. */
export type AlertIndicator = {
  id: string; // id indicator (sma, ema, wma, rsi, macd, bb, stoch)
  inputs: Record<string, number | string | boolean>; // tham số đã điền đủ lúc tạo (đổi Settings của indicator sau đó không đổi alert)
  plot: string; // đường được xét
  vs: string; // "level" (so với `level` của alert), "price" (giá) hoặc id một đường khác
  label: string; // "RSI 14 close"
  vs_label?: string; // tên đường `vs` (backend điền)
};

export type Alert = {
  id: string;
  symbol: string;
  cond: AlertCond;
  level: number;
  trigger: AlertTrigger;
  tf: string; // khung của "mỗi nến" / "đóng nến"
  expires_at: number | null; // epoch giây, null = không hạn
  name: string;
  message: string;
  channels: AlertChannels;
  state: AlertState;
  created_at: number;
  fired_at: number | null;
  fire_count: number;
  drawing: AlertDrawing | null; // alert trên hình vẽ: mức giá do hình quyết định (`level` chỉ là giá trị gần đây để hiển thị)
  indicator: AlertIndicator | null; // alert theo indicator: `level` chỉ có nghĩa khi indicator.vs = "level"
  on_chart: boolean; // true: chart vẽ đường giá (kéo được) của alert; false: chỉ nằm trong danh sách alert
};

/** Kết quả giao từng kênh của một lần nổ: "ok" hoặc lý do (tiếng Việt, từ backend). */
export type DeliveryResults = Partial<Record<ChannelKind, string>>;

/** Loại dòng nhật ký: alert giá, nhắc tin kinh tế, sự kiện giao dịch (SL / TP / lệnh chờ khớp). */
export type LogKind = "price" | "news" | "trade";

export type AlertLogRow = {
  id: number;
  alert_id: string;
  time: number;
  symbol: string;
  name: string; // alert giá: tên người đặt; tin khác: tiêu đề
  message: string;
  cond: AlertCond | LogKind;
  level: number;
  price: number;
  label: string; // tên hình vẽ nếu alert nổ trên hình ("" nếu là mức giá cố định)
  kind: LogKind;
  text: string; // nội dung của tin không phải alert giá (nhiều dòng)
  late: boolean; // báo bù: giá đã chạm lúc backend / EA tắt, `time` là giờ nến chạm
  results: DeliveryResults;
};

export type ChannelsInfo = {
  telegram: { configured: boolean; linked: boolean; name: string | null };
  mt5: { online: boolean; version: string | null; supports: boolean; push_enabled: boolean | null };
};

/** Quy tắc thông báo theo tài khoản (docs/alerts-plan.md Phase 3). Mặc định tắt. */
export type NewsRule = { enabled: boolean; leads: number[]; min_importance: 1 | 2 | 3; currencies: string[]; channels: AlertChannels };
export type TradeRule = { enabled: boolean; sl: boolean; tp: boolean; fill: boolean; channels: AlertChannels };
export type Rules = { news: NewsRule; trade: TradeRule };

export type AlertInput = {
  symbol: string;
  cond: AlertCond;
  level: number;
  trigger: AlertTrigger;
  tf: string;
  expires_at: number | null;
  name: string;
  message: string;
  channels: AlertChannels;
  drawing?: AlertDrawing | null;
  indicator?: AlertIndicator | null;
  on_chart?: boolean;
};

export type AlertPatch = Partial<Omit<AlertInput, "expires_at" | "symbol">> & { expires_at?: number; clear_expiry?: boolean; state?: "active" | "paused"; drawing?: AlertDrawing; indicator?: AlertIndicator; unlink?: boolean };

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  try {
    const res = await apiFetch(path, init);
    if (!res.ok) return { ok: false, error: res.status === 401 ? "Đăng nhập để dùng alert" : await errorMessage(res) };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: "Không kết nối được backend" };
  }
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const listAlerts = () => call<Alert[]>("/alerts");
export const createAlert = (a: AlertInput) => call<Alert>("/alerts", json("POST", a));
export const patchAlert = (id: string, p: AlertPatch) => call<Alert>(`/alerts/${encodeURIComponent(id)}`, json("PATCH", p));
export const deleteAlert = (id: string) => call<{ ok: true }>(`/alerts/${encodeURIComponent(id)}`, json("DELETE"));
export const fetchAlertLog = (limit = 100) => call<AlertLogRow[]>(`/alerts/log?limit=${limit}`);
export const fetchRules = () => call<Rules>("/alerts/rules");
export const patchRule = <K extends keyof Rules>(kind: K, p: Partial<Rules[K]>) => call<Rules[K]>(`/alerts/rules/${kind}`, json("PATCH", p));
export const fetchChannels = () => call<ChannelsInfo>("/alerts/channels");
export const linkTelegram = () => call<{ url: string; expires_in: number }>("/alerts/channels/telegram/link", json("POST"));
export const unlinkTelegram = () => call<{ ok: true }>("/alerts/channels/telegram", json("DELETE"));
export const testChannel = (kind: ChannelKind) => call<{ ok: boolean; detail: string }>(`/alerts/channels/${kind}/test`, json("POST"));
