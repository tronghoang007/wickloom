import type { SymbolInfo } from "@/lib/api";
import type { Mt5Account } from "@/lib/mt5Api";
import { draftPrices, parseNum, type Draft } from "./draft";
import { tradeBlock } from "./gate";
import { lotSpec } from "./lot";
import { validateMarket, validatePending } from "./orderType";

// Kiểm tra bản nháp lệnh: dùng chung cho panel bên phải (hiện lỗi, khoá nút) và thanh đặt lệnh trên chart (nút Buy / Sell). Hàm thuần.
export type DraftEnv = {
  sym: SymbolInfo | undefined;
  quote: { bid: number; ask: number } | undefined;
  account: Mt5Account | undefined;
  status: "loading" | "guest" | "user";
  loaded: boolean;
  nowSec: number;
};

/** Vì sao bản nháp chưa gửi được (null = được): chặn chung của giao dịch (tradeBlock) rồi luật riêng của Market / lệnh chờ. */
export function draftError(d: Draft, e: DraftEnv): string | null {
  const spec = lotSpec(e.sym, e.account?.max_lot);
  const gate = tradeBlock({ status: e.status, loaded: e.loaded, account: e.account, spec, hasQuote: !!e.quote });
  if (gate) return gate;
  const digits = e.sym?.digits ?? 5;
  const lot = parseNum(d.lot);
  const { price, sl, tp } = draftPrices(d, e.quote);
  const bid = e.quote?.bid ?? 0;
  const ask = e.quote?.ask ?? 0;
  if (d.mode === "market") return validateMarket({ side: d.side, lot, sl, tp, bid, ask, digits, stopsLevel: e.sym?.stops_level, spec });
  const expiration = d.until && d.untilText ? Math.floor(new Date(d.untilText).getTime() / 1000) : 0;
  return (
    validatePending({ side: d.side, price, lot, sl, tp, expiration, bid, ask, digits, stopsLevel: e.sym?.stops_level, spec, nowSec: e.nowSec }) ??
    (d.until && !expiration ? "Chọn thời điểm hết hạn" : null)
  );
}
