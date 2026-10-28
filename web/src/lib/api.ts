export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
export type SymbolInfo = {
  name: string; digits: number; tick_size: number; type: string; description?: string; broker?: string;
  // thông số giao dịch (EA >= 2.12); null/thiếu = EA cũ chưa báo
  volume_min?: number | null; volume_max?: number | null; volume_step?: number | null;
  contract_size?: number | null; stops_level?: number | null; freeze_level?: number | null;
  tick_value?: number | null; tick_value_loss?: number | null; // giá trị một tick lãi / lỗi theo tiền account (EA >= 2.14)
};

export const TF_SECONDS: Record<string, number> = {
  M1: 60, M2: 120, M3: 180, M4: 240, M5: 300, M6: 360, M10: 600, M12: 720, M15: 900, M20: 1200, M30: 1800,
  H1: 3600, H2: 7200, H3: 10800, H4: 14400, H6: 21600, H8: 28800, H12: 43200,
  D1: 86400, W1: 604800, MN1: 2592000,
};

// Host của API theo host của trang: cookie phiên cấp bởi 127.0.0.1:8000 không đi theo fetch từ trang localhost:3000
// (và ngược lại), nên mở bằng host nào thì gọi API bằng host đó. NEXT_PUBLIC_API (nếu đặt) thắng.
export const API =
  process.env.NEXT_PUBLIC_API ??
  (typeof window === "undefined" ? "http://127.0.0.1:8000" : `${location.protocol}//${location.hostname}:8000`);
export const WS_URL = API.replace(/^http/, "ws") + "/ws";

let onUnauthorized: ((path: string) => void) | null = null;
/** Store auth đăng ký để biết khi /me/* trả 401 (phiên hết hạn giữa chừng) (không import ngược store vào đây - tránh vòng phụ thuộc). */
export function setUnauthorizedHandler(fn: ((path: string) => void) | null) {
  onUnauthorized = fn;
}

/** fetch tới backend kèm cookie phiên. Nhận path (`/me/watchlist`) hoặc URL đầy đủ (DrawingSync truyền `${API}/...`). */
export async function apiFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" && input.startsWith("/") ? `${API}${input}` : String(input);
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(url, { ...init, headers, credentials: "include" });
  if (res.status === 401) {
    const path = new URL(url).pathname;
    if (path.startsWith("/me/")) onUnauthorized?.(path); // /auth/me 401 = khách, store tự xử lý trong refresh()
  }
  return res;
}

/** Thông báo lỗi tiếng Việt từ `{detail}` của backend (422 của pydantic có detail dạng mảng -> câu chung). */
export async function errorMessage(res: Response): Promise<string> {
  try {
    const d = (await res.json())?.detail;
    if (typeof d === "string") return d;
  } catch {
    /* thân không phải JSON */
  }
  return res.status === 422 ? "Dữ liệu không hợp lệ" : `Lỗi ${res.status}`;
}

export async function fetchBars(symbol: string, tf: string, to?: number, limit = 500, from?: number): Promise<Bar[]> {
  const q = new URLSearchParams({ symbol, tf, limit: String(limit) });
  if (to !== undefined) q.set("to", String(to));
  if (from !== undefined) q.set("from", String(from));
  const r = await fetch(`${API}/bars?${q}`);
  return r.ok ? r.json() : [];
}

/** Volume lên / xuống của tick trong các phút [from, to) gom vào `n` row cao `size` bắt đầu từ giá `lo` (backend /tickvp); null nếu lỗi. */
export async function fetchTickProfile(symbol: string, from: number, to: number, lo: number, size: number, n: number): Promise<{ up: number[]; dn: number[] } | null> {
  const q = new URLSearchParams({ symbol, from: String(from), to: String(to), lo: String(lo), size: String(size), n: String(n) });
  try {
    const r = await fetch(`${API}/tickvp?${q}`);
    const j = r.ok ? await r.json() : null;
    return j && Array.isArray(j.up) && Array.isArray(j.dn) ? { up: j.up, dn: j.dn } : null;
  } catch {
    return null;
  }
}

/** Một ô (phút, giá) của lịch sử tick: volume tick lên / xuống ở giá `p` trong phút bắt đầu lúc `t`. */
export type TickCell = { t: number; p: number; up: number; dn: number };

/** Tối đa `limit` ô (phút, giá) lớn nhất trong [from, to) có volume tick >= `min` (backend /tickbig), tăng dần theo t; `size` > 0 gom giá vào row cao `size`. null nếu lỗi. */
export async function fetchTickBig(symbol: string, from: number, to: number, min: number, limit: number, size: number): Promise<TickCell[] | null> {
  const q = new URLSearchParams({ symbol, from: String(from), to: String(to), min: String(min), limit: String(limit), size: String(size) });
  try {
    const r = await fetch(`${API}/tickbig?${q}`);
    const j = r.ok ? await r.json() : null;
    return j && Array.isArray(j.rows) ? j.rows.map(([t, p, up, dn]: number[]) => ({ t, p, up, dn })) : null;
  } catch {
    return null;
  }
}

/** Thống kê volume của mọi ô (phút, giá) trong [from, to): số ô, tổng và tổng bình phương volume (backend /tickstat); `size` > 0 gom giá vào row cao `size` như /tickbig. null nếu lỗi. */
export type TickStat = { n: number; sum: number; sumsq: number };
export async function fetchTickStat(symbol: string, from: number, to: number, size: number): Promise<TickStat | null> {
  const q = new URLSearchParams({ symbol, from: String(from), to: String(to), size: String(size) });
  try {
    const r = await fetch(`${API}/tickstat?${q}`);
    const j = r.ok ? await r.json() : null;
    return j && Number.isFinite(j.n) && Number.isFinite(j.sum) && Number.isFinite(j.sumsq) ? { n: j.n, sum: j.sum, sumsq: j.sumsq } : null;
  } catch {
    return null;
  }
}

/** Một ô footprint: [chỉ số nến trong danh sách gửi đi, row giá (phủ [row*size, (row+1)*size)), volume lên, volume xuống]. */
export type FpCell = [bar: number, row: number, up: number, dn: number];

/** Tick của các phút [bars[0], end) gom theo (nến, row giá cao `size`) (backend /tickfp); `bars` = giờ mở các nến tăng dần (tối đa 1000). null nếu lỗi. */
export async function fetchTickFp(symbol: string, bars: number[], end: number, size: number): Promise<FpCell[] | null> {
  const q = new URLSearchParams({ symbol, bars: bars.join(","), end: String(end), size: String(size) });
  try {
    const r = await fetch(`${API}/tickfp?${q}`);
    const j = r.ok ? await r.json() : null;
    return j && Array.isArray(j.rows) ? (j.rows as FpCell[]) : null;
  } catch {
    return null;
  }
}

/** Giây: giờ broker − UTC (EA báo cho backend); 0 nếu backend chưa biết / không trả lời. */
export async function fetchBrokerOffset(): Promise<number> {
  try {
    const r = await fetch(`${API}/health`);
    const v = r.ok ? (await r.json())?.offset : 0;
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

// Xin EA nạp `count` bar cũ hơn mốc `before` (epoch UTC giây): scroll-back và nhảy tới
// 1 thời điểm chưa từng tải (đổi timeframe lúc đang replay).
export async function triggerBackfillAt(symbol: string, tf: string, count = 500, before = 0): Promise<{ ok: boolean }> {
  const r = await fetch(`${API}/backfill?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&count=${count}&before=${before}`, {
    method: "POST",
  });
  return r.ok ? r.json() : { ok: false };
}

export async function fetchSymbols(): Promise<SymbolInfo[]> {
  const r = await fetch(`${API}/symbols`);
  return r.ok ? r.json() : [];
}

// Watchlist của user đăng nhập: 1 document `/me/watchlist` (backend gắn chủ sở hữu theo phiên). Khách không gọi.
// 404 = chưa có watchlist ([]); lỗi khác (401, 5xx, mạng) thì ném ra - coi là rỗng rồi lưu đè sẽ xoá watchlist thật.
export async function getWatchlist(): Promise<string[]> {
  const r = await apiFetch("/me/watchlist");
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const row = await r.json();
  return Array.isArray(row?.data?.symbols) ? row.data.symbols : [];
}

/** Ném lỗi khi không lưu được (người gọi báo cho người dùng). */
export async function saveWatchlist(symbols: string[]): Promise<void> {
  const r = await apiFetch("/me/watchlist", { method: "PUT", body: JSON.stringify({ symbols }) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}
