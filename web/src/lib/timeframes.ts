import { TF_SECONDS } from "./api";

// Dropdown timeframe của TradingView, chỉ giữ khung MT5 có (bỏ tick/giây/range, 45 phút,
// 3/6/12 tháng).
export const TF_MENU: { title: string; tfs: string[] }[] = [
  { title: "Minutes", tfs: ["M1", "M2", "M3", "M5", "M10", "M15", "M30"] },
  { title: "Hours", tfs: ["H1", "H2", "H3", "H4"] },
  { title: "Days", tfs: ["D1", "W1", "MN1"] },
];

// Khung mặc định hiện trên toolbar (TV: 1m 5m 15m 30m 1h 4h D)
export const DEFAULT_FAV_TFS = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];

// Nhãn ngắn trên toolbar: "15m", "4h", "D", "W", "M"
export function tfShort(tf: string) {
  if (tf === "D1") return "D";
  if (tf === "W1") return "W";
  if (tf === "MN1") return "M";
  const sec = TF_SECONDS[tf];
  return sec >= 3600 ? `${sec / 3600}h` : `${sec / 60}m`;
}

// Nhãn đầy đủ trong menu: "15 minutes", "1 hour", "1 day"
export function tfLong(tf: string) {
  if (tf === "D1") return "1 day";
  if (tf === "W1") return "1 week";
  if (tf === "MN1") return "1 month";
  const sec = TF_SECONDS[tf];
  const [n, unit] = sec >= 3600 ? [sec / 3600, "hour"] : [sec / 60, "minute"];
  return `${n} ${unit}${n > 1 ? "s" : ""}`;
}
