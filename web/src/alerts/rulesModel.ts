import type { AlertChannels, NewsRule, Rules, TradeRule } from "@/lib/alertsApi";

// Phần thuần của quy tắc thông báo (nhắc tin kinh tế, sự kiện giao dịch): các lựa chọn hiển thị và phép bật / tắt từng mục. Không React, không mạng.

export const MAX_LEADS = 3;
/** Các mốc báo trước hiện ra để chọn (phút). Backend nhận 1..1440. */
export const LEAD_CHOICES = [60, 30, 15, 5, 1];
export const IMPORTANCE_CHOICES: { value: NewsRule["min_importance"]; label: string }[] = [
  { value: 3, label: "High only" },
  { value: 2, label: "Medium and High" },
  { value: 1, label: "All events" },
];
export const CURRENCY_CHOICES = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "CNY"];

export const leadLabel = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`);

/** Bật / tắt một mốc báo trước. Phải còn ít nhất một mốc và không quá MAX_LEADS; trả null khi thao tác không hợp lệ (giữ nguyên). Kết quả xếp giảm dần như backend. */
export function toggleLead(leads: number[], m: number): number[] | null {
  const has = leads.includes(m);
  if (has && leads.length === 1) return null;
  if (!has && leads.length >= MAX_LEADS) return null;
  return (has ? leads.filter((x) => x !== m) : [...leads, m]).sort((a, b) => b - a);
}

/** Bật / tắt một đồng tiền; rỗng = mọi đồng tiền. */
export const toggleCurrency = (list: string[], c: string): string[] => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c].sort());

/** Các đồng tiền hiện ra: danh sách cố định cộng thêm mã nào đã lưu mà không có trong đó (đặt qua API). */
export const currencyChoices = (saved: string[]): string[] => [...CURRENCY_CHOICES, ...saved.filter((c) => !CURRENCY_CHOICES.includes(c))];

/** Tóm tắt một dòng cho quy tắc tin kinh tế: "High only · 15 min, 5 min · USD, EUR". */
export function newsSummary(r: NewsRule): string {
  const imp = IMPORTANCE_CHOICES.find((o) => o.value === r.min_importance)?.label ?? "";
  return [imp, r.leads.map(leadLabel).join(", "), r.currencies.length ? r.currencies.join(", ") : "all currencies"].join(" · ");
}

export const channelsOn = (c: AlertChannels) => c.web || c.telegram || c.mt5;

/** Bật quy tắc mà chưa chọn kênh nào thì không có nơi nhận: chặn trước khi gọi backend. */
export function ruleProblem(kind: keyof Rules, next: Rules[keyof Rules], telegramLinked: boolean | null): string | null {
  if (!next.enabled) return null;
  if (!channelsOn(next.channels)) return "Chọn ít nhất một kênh nhận thông báo";
  if (next.channels.telegram && telegramLinked === false) return "Chưa kết nối Telegram (mục Telegram bên dưới)";
  if (kind === "trade") {
    const t = next as TradeRule;
    if (!t.sl && !t.tp && !t.fill) return "Chọn ít nhất một loại sự kiện";
  }
  return null;
}
