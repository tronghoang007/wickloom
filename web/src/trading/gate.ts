import type { Mt5Account } from "@/lib/mt5Api";
import type { LotSpec } from "./lot";
import { SIM_ACCOUNT_ID } from "./simId";

export type GateInput = {
  replay?: boolean; // chart đang hỏi có đang Replay không (bỏ trống = không xét): Replay chỉ giao dịch với account giả lập, chart thường chỉ với account MT5
  status: "loading" | "guest" | "user";
  loaded: boolean; // đã hỏi /accounts ít nhất một lần
  account: Mt5Account | undefined; // account MT5 đang cấp dữ liệu
  spec: LotSpec | null;
  hasQuote: boolean;
};

/** Vì sao chưa gửi lệnh được (null = được). Khách thì để nút bấm được và bật popup đăng nhập; mọi chặn khác chỉ là gợi ý cho người dùng:
 *  backend và EA mới là nơi quyết định (T2: chỉ account demo, EA phải bật TradingEnabled). */
export function tradeBlock(i: GateInput): string | null {
  const sim = i.account?.id === SIM_ACCOUNT_ID;
  if (i.replay !== undefined && i.replay !== sim) return i.replay ? "Đang tải account giả lập của Replay…" : "Đang Replay: giao dịch giả lập trên chart đang Replay";
  if (sim) {
    // account giả lập của Replay (trading/sim.ts): không cần đăng nhập / EA, chỉ cần thông số lot và giá replay
    if (!i.spec) return "Chưa có thông số lot của symbol (cần EA ≥ 2.12)";
    if (!i.hasQuote) return "Chưa có giá replay";
    return null;
  }
  if (i.status === "loading") return "Đang kết nối…";
  if (i.status === "guest") return null;
  if (!i.loaded) return "Đang tải account MT5…";
  const a = i.account;
  if (!a) return "Chưa có account MT5 kết nối";
  if (!a.online) return "Account MT5 đang offline";
  if (a.mode !== "demo") return "Hiện chỉ giao dịch được trên account demo";
  if (a.ea_trading !== true) return "EA chưa bật giao dịch: đặt TradingEnabled = true trong cài đặt EA (cần EA ≥ 2.12)";
  if (a.terminal_trade_allowed === false) return "AutoTrading đang tắt trên MT5 (bật nút Algo Trading)";
  if (a.trade_allowed === false) return "Account không cho giao dịch (đăng nhập bằng investor password?)";
  if (!i.spec) return "Chưa có thông số lot của symbol (cần EA ≥ 2.12)";
  if (!i.hasQuote) return "Chưa có giá";
  return null;
}

/** Dòng "Web trading" của tab Account: vì sao nút SELL/BUY dùng được hay không (T2: chỉ demo, EA phải bật TradingEnabled). */
export function webTrading(a: Mt5Account): string {
  if (a.mode !== "demo") return "Chỉ demo (tạm thời)";
  if (a.ea_trading !== true) return a.ea_version ? "Tắt (TradingEnabled)" : "Tắt (cần EA ≥ 2.12)";
  return a.max_lot ? `Bật · tối đa ${a.max_lot} lot/lệnh` : "Bật";
}
