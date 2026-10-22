import type { Mt5Account, Mt5Mode } from "./mt5Api";

// Huy hiệu trên avatar và nhãn trong dropdown: đỏ = Real (tiền thật), xanh lá = Demo, xám = offline / chưa biết.
export const MODE_LABEL: Record<Mt5Mode, string> = { demo: "DEMO", real: "REAL", contest: "CONTEST", unknown: "" };
export const MODE_COLOR: Record<Mt5Mode, string> = { demo: "#089981", real: "#f23645", contest: "#d69a00", unknown: "#787b86" };
const OFFLINE_COLOR = "#787b86";

export const badgeColor = (a: Mt5Account | undefined) => (a && a.online ? MODE_COLOR[a.mode] : OFFLINE_COLOR);

/** Tên hiển thị: tên chủ account; EA cũ không báo thì công ty/server. */
export const accountTitle = (a: Mt5Account) => a.name || a.broker || a.server;

/** Dòng 2: "#12345678 · Exness-MT5Trial17 · 1:500 · offline" (login đứng đầu để không bị cắt). */
export const accountSub = (a: Mt5Account) =>
  [a.login ? `#${a.login}` : "", a.server, a.leverage ? `1:${a.leverage}` : "", a.online ? "" : "offline"].filter(Boolean).join(" · ");

export const fmtMoney = (n: number | undefined, ccy: string) =>
  n === undefined ? "—" : `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${ccy ? ` ${ccy}` : ""}`;

/** Tooltip avatar: "Trading: Exness-MT5Trial17 #12345678 (Demo)" / "(offline)" / "" khi chưa có account nào. */
export function tradingTooltip(accounts: Mt5Account[]): string {
  const a = accounts.find((x) => x.active);
  if (!a) return "";
  const mode = MODE_LABEL[a.mode] ? ` (${a.mode[0].toUpperCase()}${a.mode.slice(1)})` : "";
  return `Trading: ${a.server}${a.login ? ` #${a.login}` : ""}${mode}${a.online ? "" : " — offline"}`;
}
