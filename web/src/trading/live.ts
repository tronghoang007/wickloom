import { useMemo } from "react";
import type { SymbolInfo } from "@/lib/api";
import type { TradeData } from "@/lib/mt5Api";
import { chartGlobal } from "@/store/chart";
import { totalPnl } from "./format";
import { estimatePnl, exactPnlSpec, pnlSpec } from "./pnl";
import { quoteFresh, useQuoteStore } from "./quote";
import { SIM_ACCOUNT_ID } from "./simId";
import { useTradeStore } from "./store";

type Quote = { bid: number; ask: number };

/** Làm tròn 2 chữ số, nửa xa số 0 như MT5 (Math.round đưa -0.125 về -0.12); +1e-9 bù sai số dấu phẩy động (0.0049999… của 0.005). */
const round2 = (v: number) => (Math.sign(v) * Math.round(Math.abs(v) * 100 + 1e-9)) / 100;

/** Lãi / lỗ nhảy theo từng tick như MT5 (user 10-29: "P/L nhảy chậm", "Unrealized +3.97 mà vị thế +3.27"). EA gửi vị thế mỗi 1s, account (profit, equity) mỗi 5s, web còn
 *  hỏi backend mỗi 2s: số đã cũ vài giây và hai nhịp lệch nhau. Ở đây lấy số MT5 gửi làm mốc rồi cộng lãi / lỗ của quãng giá từ `price_current` (giá EA chụp) tới giá đóng
 *  hiện tại theo tick chart nhận (Buy đóng ở Bid, Sell ở Ask), cùng giá trị tick MT5 báo. Account tính lại từ chính các vị thế đó: Unrealized = tổng P/L vị thế,
 *  Equity = (balance + credit lúc EA chụp account) + Unrealized, Free margin / Margin level theo Equity mới. Symbol chưa có tick / thiếu thông số thì giữ số MT5. Hàm thuần. */
export function liveTrade(data: TradeData | null, quotes: Record<string, Quote>, symbols: SymbolInfo[], fresh: (symbol: string) => boolean = () => true): TradeData | null {
  if (!data || data.positions.length === 0 || data.account.id === SIM_ACCOUNT_ID) return data; // sổ giả lập của Replay đã tính theo giá của chính nó
  const a = data.account;
  const positions = data.positions.map((p) => {
    const q = quotes[p.symbol];
    if (!q || !fresh(p.symbol) || (p.type !== "buy" && p.type !== "sell")) return p;
    const now = p.type === "buy" ? q.bid : q.ask;
    const sym = symbols.find((s) => s.name === p.symbol);
    // symbol tính bằng đồng tiền account: tính thẳng từ giá mở như MT5 (cộng dồn lên số MT5 đã làm tròn có thể lệch 0.01); còn lại cộng quãng giá vào số MT5 (giữ tỉ giá quy đổi của MT5)
    const exact = exactPnlSpec(sym, a.currency);
    if (exact) return now === p.price_current ? p : { ...p, price_current: now, profit: round2(estimatePnl(p.type, p.volume, p.price_open, now, exact)) };
    const spec = pnlSpec(sym, a.currency);
    if (now === p.price_current || !spec) return p;
    return { ...p, price_current: now, profit: round2(p.profit + estimatePnl(p.type, p.volume, p.price_current, now, spec)) };
  });
  const unrealized = round2(totalPnl(positions));
  const account = { ...a, profit: unrealized };
  if (a.equity !== undefined) {
    const base = a.equity - (a.profit ?? totalPnl(data.positions)); // balance + credit cùng lần chụp với equity
    account.equity = round2(base + unrealized);
    if (a.margin !== undefined) {
      account.margin_free = round2(account.equity - a.margin);
      if (a.margin > 0) account.margin_level = (account.equity / a.margin) * 100;
    }
  }
  return { ...data, positions, account };
}

/** Giá trong kho cũ hơn mức này (không còn ai subscribe symbol đó, vd chart vừa rời đi rồi mới mở lệnh) thì dùng số MT5 thay vì giá cũ. Thị trường đứng yên lâu hơn thế thì
 *  số MT5 cũng ở đúng giá cuối, không mất gì. */
const QUOTE_MAX_AGE_MS = 10_000;
const freshNow = (symbol: string) => quoteFresh(symbol, QUOTE_MAX_AGE_MS);

/** `liveTrade` cho component: tính lại mỗi tick (giá THẬT, kể cả khi pane khác đang Replay). */
export function useLiveTrade(data: TradeData | null): TradeData | null {
  const quotes = useQuoteStore((s) => s.real);
  const symbols = chartGlobal((s) => s.symbols);
  return useMemo(() => liveTrade(data, quotes, symbols, freshNow), [data, quotes, symbols]);
}

/** Dữ liệu lệnh đang hiện (`useTradeStore.data`) với lãi / lỗ theo tick mới nhất, đọc ngay cho code ngoài React. */
export const liveTradeNow = () => liveTrade(useTradeStore.getState().data, useQuoteStore.getState().real, chartGlobal.getState().symbols, freshNow);
