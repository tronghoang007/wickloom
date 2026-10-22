import { apiFetch, errorMessage } from "./api";

// Gửi lệnh giao dịch qua backend (docs/trade-plan.md T2): POST /accounts/{id}/orders, DELETE /accounts/{id}/positions/{ticket}.
export type TradeResult = {
  ok: boolean; // sàn đã khớp
  message: string; // tiếng Việt khi ok = false
  retcode: number;
  order: number;
  deal: number;
  price: number;
  volume: number;
  duplicate?: boolean; // cùng một cú bấm đã gửi trước đó: đây là kết quả cũ
};

/** done = backend đã có câu trả lời của EA (ok hoặc sàn từ chối). error = chưa/không chắc lệnh tới sàn; `unknown` = có thể đã tới sàn (504, mất kết nối giữa chừng):
 *  KHÔNG tự gửi lại, bảo người dùng xem tab Positions. */
export type TradeOutcome = { kind: "done"; result: TradeResult } | { kind: "error"; status: number; message: string; unknown: boolean };

async function outcome(call: () => Promise<Response>): Promise<TradeOutcome> {
  let res: Response;
  try {
    res = await call();
  } catch {
    return { kind: "error", status: 0, message: "Mất kết nối tới backend: lệnh có thể đã gửi, xem tab Positions trước khi gửi lại", unknown: true };
  }
  if (res.ok) {
    try {
      const j = await res.json();
      return {
        kind: "done",
        result: {
          ok: j.ok === true, message: typeof j.message === "string" ? j.message : "", retcode: Number(j.retcode) || 0, order: Number(j.order) || 0,
          deal: Number(j.deal) || 0, price: Number(j.price) || 0, volume: Number(j.volume) || 0, duplicate: j.duplicate === true,
        },
      };
    } catch {
      return { kind: "error", status: res.status, message: "Phản hồi không đọc được: xem tab Positions trước khi gửi lại", unknown: true };
    }
  }
  return { kind: "error", status: res.status, message: await errorMessage(res), unknown: res.status === 504 };
}

export type MarketOrder = { symbol: string; side: "buy" | "sell"; volume: number; sl?: number; tp?: number; clientId: string };

export const sendMarketOrder = (accountId: string, o: MarketOrder): Promise<TradeOutcome> =>
  outcome(() =>
    apiFetch(`/accounts/${encodeURIComponent(accountId)}/orders`, {
      method: "POST",
      body: JSON.stringify({ symbol: o.symbol, side: o.side, volume: o.volume, sl: o.sl ?? 0, tp: o.tp ?? 0, client_id: o.clientId }),
    }),
  );

/** `volume` 0 = đóng hết, khác 0 = đóng một phần. */
export const sendClosePosition = (accountId: string, ticket: number, volume = 0): Promise<TradeOutcome> =>
  outcome(() => apiFetch(`/accounts/${encodeURIComponent(accountId)}/positions/${ticket}?volume=${volume}`, { method: "DELETE" }));
