export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
export type SymbolInfo = { name: string; digits: number; tick_size: number; type: string; description?: string; broker?: string };

export const TF_SECONDS: Record<string, number> = {
  M1: 60, M2: 120, M3: 180, M4: 240, M5: 300, M6: 360, M10: 600, M12: 720, M15: 900, M20: 1200, M30: 1800,
  H1: 3600, H2: 7200, H3: 10800, H4: 14400, H6: 21600, H8: 28800, H12: 43200,
  D1: 86400, W1: 604800, MN1: 2592000,
};

export const API = process.env.NEXT_PUBLIC_API ?? "http://127.0.0.1:8000";
export const WS_URL = API.replace(/^http/, "ws") + "/ws";

export async function fetchBars(symbol: string, tf: string, to?: number, limit = 500, from?: number): Promise<Bar[]> {
  const q = new URLSearchParams({ symbol, tf, limit: String(limit) });
  if (to !== undefined) q.set("to", String(to));
  if (from !== undefined) q.set("from", String(from));
  const r = await fetch(`${API}/bars?${q}`);
  return r.ok ? r.json() : [];
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

// Watchlist: 1 document duy nhất id="default" trong bảng `watchlists` (CRUD generic đã
// có sẵn ở backend, xem backend/app/store.py TABLES) - không cần endpoint riêng.
export async function getWatchlist(): Promise<string[]> {
  const r = await fetch(`${API}/watchlists/default`);
  if (!r.ok) return [];
  const row = await r.json();
  return Array.isArray(row?.data?.symbols) ? row.data.symbols : [];
}

export async function saveWatchlist(symbols: string[]): Promise<void> {
  await fetch(`${API}/watchlists/default?scope=default`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbols }),
  }).catch(() => {});
}
