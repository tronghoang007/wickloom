import { WS_URL } from "@/lib/api";
import { useQuoteStore } from "./quote";
import { useTradeStore } from "./store";

// Tick của các symbol đang có vị thế / lệnh chờ trên MT5, cho lãi / lỗ theo tick (trading/live.ts). Kho giá vốn chỉ nhận tick qua WebSocket của chart, mà backend chỉ đẩy tick
// cho client đã subscribe symbol đó: chart đang mở symbol khác (lệnh vàng, chart xem BTC) thì P/L chỉ đổi theo nhịp hỏi /trade 2s (user 10-29 "P/L không nhảy realtime").
// Một kết nối riêng subscribe M1 của từng symbol có lệnh (backend chưa có kiểu subscribe chỉ-tick) và chỉ lấy tick, bỏ nến.
const TF = "M1";
const RETRY_MS = 2000;

/** Bật nguồn tick theo symbol của lệnh MT5 (`useTradeStore.real`), tự subscribe / unsubscribe khi danh sách lệnh đổi. Trả về hàm dừng. */
export function startQuoteFeed(): () => void {
  let ws: WebSocket | null = null;
  let subs = new Set<string>();
  let retry: ReturnType<typeof setTimeout> | undefined;
  let alive = true;

  const wanted = () => {
    const d = useTradeStore.getState().real;
    return new Set([...(d?.positions ?? []), ...(d?.orders ?? [])].map((x) => x.symbol));
  };
  const send = (action: "subscribe" | "unsubscribe", symbol: string) => ws!.send(JSON.stringify({ action, symbol, tf: TF }));

  const sync = () => {
    if (!alive) return;
    const want = wanted();
    if (want.size === 0) {
      // hết lệnh: đóng kết nối để EA thôi stream symbol không ai xem
      const s = ws;
      ws = null;
      subs = new Set();
      s?.close();
      return;
    }
    if (!ws) return connect();
    if (ws.readyState !== WebSocket.OPEN) return; // onopen sẽ gọi lại
    for (const s of want) if (!subs.has(s)) send("subscribe", s);
    for (const s of subs) if (!want.has(s)) send("unsubscribe", s);
    subs = want;
  };

  const connect = () => {
    const sock = new WebSocket(WS_URL);
    ws = sock;
    subs = new Set();
    sock.onopen = () => {
      if (ws === sock) sync();
    };
    sock.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "tick" && subs.has(m.symbol)) useQuoteStore.getState().set(m.symbol, m.bid, m.ask);
    };
    sock.onclose = () => {
      if (ws !== sock) return; // đóng chủ động (hết lệnh / dừng)
      ws = null;
      clearTimeout(retry);
      retry = setTimeout(sync, RETRY_MS);
    };
  };

  sync();
  const unsub = useTradeStore.subscribe((s, prev) => {
    if (s.real !== prev.real) sync();
  });
  return () => {
    alive = false;
    clearTimeout(retry);
    unsub();
    const s = ws;
    ws = null;
    s?.close();
  };
}
