import { apiFetch } from "./api";

export type Mt5Mode = "demo" | "real" | "contest" | "replay" | "unknown"; // replay = account giả lập của Replay (trading/sim.ts), không phải MT5

/** Account MT5 mà EA TVBridge báo lên (GET /accounts). `login`/`name`/số dư thiếu khi EA < v2.10. */
export type Mt5Account = {
  id: string;
  server: string;
  broker: string;
  login: number | null;
  name: string;
  mode: Mt5Mode;
  currency: string;
  leverage: number | null;
  balance?: number;
  equity?: number;
  margin?: number;
  margin_free?: number;
  margin_level?: number; // %, 0 khi không có vị thế
  profit?: number;
  margin_mode?: "netting" | "hedging" | "exchange";
  trade_allowed?: boolean; // account cho phép giao dịch (investor password thì false)
  terminal_trade_allowed?: boolean; // nút Algo Trading của MT5 đang bật
  ea_trading?: boolean; // EA bật TradingEnabled (EA >= 2.12); thiếu = EA cũ, coi như chưa bật
  max_lot?: number; // MaxLotPerOrder của EA
  ea_version?: string;
  online: boolean;
  active: boolean; // account đang cấp dữ liệu (hoặc vừa cấp gần nhất khi offline)
  seen: number;
};

export type Mt5List = { accounts: Mt5Account[]; switchable: boolean };

/** null = không lấy được (khách 401, backend tắt, lỗi) — người gọi quyết định giữ hay xoá danh sách cũ. */
export async function fetchMt5Accounts(): Promise<{ list: Mt5List | null; unauthorized: boolean }> {
  let res: Response;
  try {
    res = await apiFetch("/accounts");
  } catch {
    return { list: null, unauthorized: false };
  }
  if (res.status === 401) return { list: null, unauthorized: true };
  if (!res.ok) return { list: null, unauthorized: false };
  try {
    const j = await res.json();
    return { list: { accounts: Array.isArray(j.accounts) ? j.accounts : [], switchable: j.switchable === true }, unauthorized: false };
  } catch {
    return { list: null, unauthorized: false };
  }
}

// --- trạng thái giao dịch CHỈ ĐỌC (GET /accounts/{id}/trade; docs/trade-plan.md T1) ---
export type Position = {
  ticket: number; symbol: string; type: "buy" | "sell" | "other"; volume: number; price_open: number; sl: number; tp: number;
  price_current: number; profit: number; swap: number; time: number; magic: number; comment: string;
};
export type PendingOrder = {
  ticket: number; symbol: string; type: "buy_limit" | "sell_limit" | "buy_stop" | "sell_stop" | "buy_stop_limit" | "sell_stop_limit" | "other";
  volume: number; price_open: number; price_stoplimit: number; sl: number; tp: number; time_setup: number; expiration: number; magic: number; comment: string;
};
export type Deal = {
  ticket: number; order: number; symbol: string; type: "buy" | "sell" | "balance" | "other"; entry: "in" | "out" | "inout" | "";
  volume: number; price: number; profit: number; commission: number; swap: number; time: number; magic: number; comment: string;
  /** EA 2.18+: mã vị thế mà deal thuộc về (0 = deal nạp/rút), SL/TP lúc khớp, lý do (client/mobile/web/expert/sl/tp/so); EA cũ không gửi. */
  position?: number; sl?: number; tp?: number; reason?: string;
};
export type TradeData = { account: Mt5Account; positions: Position[]; orders: PendingOrder[]; deals: Deal[]; updated_at: number | null };

/** null = chưa lấy được (khách 401, account không có 404, lỗi mạng); `gone` = account không còn trong backend (404). */
export async function fetchTrade(accountId: string): Promise<{ data: TradeData | null; unauthorized: boolean; gone: boolean }> {
  let res: Response;
  try {
    res = await apiFetch(`/accounts/${encodeURIComponent(accountId)}/trade`);
  } catch {
    return { data: null, unauthorized: false, gone: false };
  }
  if (res.status === 401) return { data: null, unauthorized: true, gone: false };
  if (res.status === 404) return { data: null, unauthorized: false, gone: true };
  if (!res.ok) return { data: null, unauthorized: false, gone: false };
  try {
    const j = await res.json();
    return {
      data: {
        account: j.account,
        positions: Array.isArray(j.positions) ? j.positions : [],
        orders: Array.isArray(j.orders) ? j.orders : [],
        deals: Array.isArray(j.deals) ? j.deals : [],
        updated_at: typeof j.updated_at === "number" ? j.updated_at : null,
      },
      unauthorized: false,
      gone: false,
    };
  } catch {
    return { data: null, unauthorized: false, gone: false };
  }
}
