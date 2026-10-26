import { apiFetch, errorMessage } from "./api";

// Alert giá (docs/alerts-plan.md). Backend so điều kiện trên tick của EA nên alert nổ cả khi tắt tab; mọi lời gọi cần đăng nhập.

export type AlertCond = "cross" | "cross_up" | "cross_down" | "gt" | "lt";
export type AlertTrigger = "once" | "once_per_bar" | "once_per_bar_close" | "every_time";
export type AlertState = "active" | "paused" | "triggered" | "expired";
export type AlertChannels = { web: boolean; telegram: boolean; mt5: boolean };
export type ChannelKind = keyof AlertChannels;

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
};

/** Kết quả giao từng kênh của một lần nổ: "ok" hoặc lý do (tiếng Việt, từ backend). */
export type DeliveryResults = Partial<Record<ChannelKind, string>>;

export type AlertLogRow = {
  id: number;
  alert_id: string;
  time: number;
  symbol: string;
  name: string;
  message: string;
  cond: AlertCond;
  level: number;
  price: number;
  results: DeliveryResults;
};

export type ChannelsInfo = {
  telegram: { configured: boolean; linked: boolean; name: string | null };
  mt5: { online: boolean; version: string | null; supports: boolean; push_enabled: boolean | null };
};

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
};

export type AlertPatch = Partial<Omit<AlertInput, "expires_at" | "symbol">> & { expires_at?: number; clear_expiry?: boolean; state?: "active" | "paused" };

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
export const fetchChannels = () => call<ChannelsInfo>("/alerts/channels");
export const linkTelegram = () => call<{ url: string; expires_in: number }>("/alerts/channels/telegram/link", json("POST"));
export const unlinkTelegram = () => call<{ ok: true }>("/alerts/channels/telegram", json("DELETE"));
export const testChannel = (kind: ChannelKind) => call<{ ok: boolean; detail: string }>(`/alerts/channels/${kind}/test`, json("POST"));
