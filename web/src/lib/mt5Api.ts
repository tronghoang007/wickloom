import { apiFetch } from "./api";

export type Mt5Mode = "demo" | "real" | "contest" | "unknown";

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
  margin_free?: number;
  profit?: number;
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
