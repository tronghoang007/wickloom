import type { Deal, PendingOrder, Position, TradeData } from "@/lib/mt5Api";

// Hàm thuần cho panel Trading và đường vị thế/lệnh chờ trên chart (docs/trade-plan.md T1: chỉ đọc).

const ORDER_LABEL: Record<PendingOrder["type"], string> = {
  buy_limit: "Buy limit", sell_limit: "Sell limit", buy_stop: "Buy stop", sell_stop: "Sell stop",
  buy_stop_limit: "Buy stop limit", sell_stop_limit: "Sell stop limit", other: "Order",
};
export const orderLabel = (t: PendingOrder["type"]) => ORDER_LABEL[t] ?? "Order";
export const sideLabel = (t: Position["type"] | Deal["type"]) => (t === "buy" ? "Buy" : t === "sell" ? "Sell" : t === "balance" ? "Balance" : "—");

/** Lot: tối thiểu 2 chữ số thập phân, tới 8 nếu symbol có step nhỏ (0.001). */
export function fmtLot(v: number): string {
  const s = v.toFixed(8).replace(/0+$/, "");
  const dec = s.split(".")[1]?.length ?? 0;
  return v.toFixed(Math.max(2, dec));
}

/** Giá theo số chữ số của symbol (biết từ danh sách symbols); không biết thì bỏ số 0 thừa. 0 = không đặt (SL/TP) → "—" khi `dash`. */
export function fmtPx(v: number, digits?: number, dash = false): string {
  if (dash && v === 0) return "—";
  return digits === undefined ? String(Number(v.toFixed(5))) : v.toFixed(digits);
}

/** "+47.50" / "-12.00" / "0.00" */
export const fmtPnl = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pnlClass = (v: number) => (v > 0 ? "text-[#089981]" : v < 0 ? "text-[#f23645]" : "text-[var(--muted)]");

export const fmtTime = (sec: number) =>
  sec ? new Date(sec * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "—";

/** P/L đang mở của các vị thế = profit + swap (commission chỉ có ở deal). */
export const positionPnl = (p: Position) => p.profit + p.swap;
export const totalPnl = (ps: Position[]) => ps.reduce((s, p) => s + positionPnl(p), 0);
/** "Profit" của account: số MT5 tự tính (ACCOUNT_PROFIT, EA gửi trong message account); EA cũ chưa báo thì cộng từ các vị thế đang mở. */
export const accountProfit = (data: TradeData) => data.account.profit ?? totalPnl(data.positions);

/** Lãi/lỗ cuối cùng của một deal trong lịch sử (kể cả phí). */
export const dealNet = (d: Deal) => d.profit + d.commission + d.swap;

export type ClosedPosition = {
  position: number; symbol: string; side: "buy" | "sell"; volume: number; open: number; close: number; sl: number; tp: number;
  openTime: number; closeTime: number; swap: number; pnl: number; reason: string;
};

const trade = (d: Deal) => d.type === "buy" || d.type === "sell";

/** Deal đã có mã vị thế thì giữ nguyên; EA cũ thì gán mã suy ra: deal ra lấy mã của deal vào cũ nhất còn khối lượng, ngược hướng với nó. */
function withPositions(deals: Deal[]): Deal[] {
  if (deals.some((d) => d.position)) return deals;
  const asc = deals.filter(trade).sort((a, b) => a.time - b.time || a.ticket - b.ticket);
  const open: { d: Deal; left: number }[] = [];
  return asc.map((d) => {
    if (d.entry === "in") {
      open.push({ d, left: d.volume });
      return { ...d, position: -d.ticket };
    }
    let left = d.volume;
    let pos = -d.ticket; // không thấy deal vào (đã ngoài cửa sổ): tự thành một vị thế
    for (const o of open) {
      if (o.left <= 1e-9 || o.d.symbol !== d.symbol || o.d.type === d.type) continue;
      if (pos === -d.ticket) pos = -o.d.ticket;
      const take = Math.min(left, o.left);
      o.left -= take;
      left -= take;
      if (left <= 1e-9) break;
    }
    return { ...d, position: pos };
  });
}

/** Comment MT5 gắn vào deal đóng bởi SL / TP / stop out: "[sl 4090.00]", "[tp 4200.098]", "[so ...]" (kèm giá chạm). EA mới gửi sẵn reason / sl / tp; EA cũ thì chỉ còn đọc được từ đây. */
const hit = (d: Deal) => {
  const m = /^\[(sl|tp|so)\s+([\d.]+)\]/i.exec(d.comment);
  return m ? { reason: m[1].toLowerCase(), price: Number(m[2]) } : null;
};
const reasonOf = (d: Deal) => d.reason || hit(d)?.reason || "";
/** SL / TP của vị thế lúc đóng: EA mới gửi trên deal; EA cũ chỉ biết mức đã chạm (đóng bởi TP thì TP = giá đó), mức còn lại để 0. */
const levelOf = (d: Deal, k: "sl" | "tp") => d[k] || (hit(d)?.reason === k ? hit(d)!.price : 0);

const wavg = (ds: Deal[]) => {
  const v = ds.reduce((s, d) => s + d.volume, 0);
  return v > 0 ? ds.reduce((s, d) => s + d.price * d.volume, 0) / v : 0;
};

/** Ghép deal vào/ra cùng mã vị thế thành các vị thế ĐÃ ĐÓNG (như tab History của TradingView), mới đóng nhất trước. Đóng nhiều lần (một phần) thì cộng khối lượng và lấy giá đóng trung bình
 *  theo khối lượng. P/L = lãi/lỗ + swap + phí của mọi deal trong vị thế. Vị thế còn mở (chưa có deal ra) và deal nạp/rút bị bỏ; deal vào đã trôi khỏi cửa sổ EA gửi thì giá/giờ mở = 0.
 *  EA cũ (< 2.18) không gửi mã vị thế: ghép theo thứ tự vào trước ra trước trong từng symbol, mã vị thế âm = tự suy ra (không phải mã MT5). */
export function closedPositions(deals: Deal[]): ClosedPosition[] {
  const by = new Map<number, Deal[]>();
  for (const d of withPositions(deals)) {
    if (!trade(d) || !d.position) continue;
    by.set(d.position, [...(by.get(d.position) ?? []), d]);
  }
  const out: ClosedPosition[] = [];
  for (const [position, ds] of by) {
    const outs = ds.filter((d) => d.entry === "out" || d.entry === "inout").sort((a, b) => a.time - b.time);
    if (outs.length === 0) continue;
    const ins = ds.filter((d) => d.entry === "in").sort((a, b) => a.time - b.time);
    const last = outs[outs.length - 1];
    out.push({
      position,
      symbol: last.symbol,
      side: last.type === "buy" ? "sell" : "buy", // deal đóng đi ngược hướng vị thế
      volume: outs.reduce((s, d) => s + d.volume, 0),
      open: wavg(ins),
      close: wavg(outs),
      sl: levelOf(last, "sl"),
      tp: levelOf(last, "tp"),
      openTime: ins[0]?.time ?? 0,
      closeTime: last.time,
      swap: ds.reduce((s, d) => s + d.swap, 0),
      pnl: ds.reduce((s, d) => s + dealNet(d), 0),
      reason: reasonOf(last),
    });
  }
  return out.sort((a, b) => b.closeTime - a.closeTime);
}

export const REASON_LABEL: Record<string, string> = { client: "Client", mobile: "Mobile", web: "Web", expert: "Expert", sl: "Stop loss", tp: "Take profit", so: "Stop out" };

export type DealSummary = { profit: number; swap: number; commission: number; deposit: number; withdrawal: number; closed: number };

/** Tổng hợp từ lịch sử deal như màn History của MT5: Profit = tổng lãi/lỗ các lệnh ĐÃ ĐÓNG (deal vào lệnh chưa có lãi/lỗ nên không tính), Swap + Commission của mọi deal mua/bán,
 *  Deposit / Withdrawal = deal nạp / rút tiền (type balance). Chỉ tính các deal EA gửi lên (gần đây, có trần số lượng). */
export function dealSummary(deals: Deal[]): DealSummary {
  const out: DealSummary = { profit: 0, swap: 0, commission: 0, deposit: 0, withdrawal: 0, closed: 0 };
  for (const d of deals) {
    if (d.type === "balance") {
      if (d.profit >= 0) out.deposit += d.profit;
      else out.withdrawal += d.profit;
    } else if (d.type === "buy" || d.type === "sell") {
      out.swap += d.swap;
      out.commission += d.commission;
      if (d.entry === "out" || d.entry === "inout") {
        out.profit += d.profit;
        out.closed += 1;
      }
    }
  }
  return out;
}

export const STALE_SECONDS = 15;
/** Dữ liệu cũ: account offline, hoặc EA lâu rồi chưa báo vị thế/lệnh. UI phải làm mờ và không vẽ đường trên chart. */
export function isStale(data: TradeData | null, nowSec: number): boolean {
  if (!data) return true;
  if (!data.account.online) return true;
  return data.updated_at === null || nowSec - data.updated_at > STALE_SECONDS;
}

export type LineStyleName = "solid" | "dashed" | "dotted";
export type TagOwner = { t: "draft" } | { t: "position"; ticket: number } | { t: "order"; ticket: number };
/** Thẻ trên chart của một đường (kiểu TradingView): [nút đặt lệnh của bản nháp] [TP+] [SL+] [lot | nhãn | ×]. `ghosts` = SL/TP chưa có: kéo nút mờ ra giá cần đặt để tạo. `side` (thẻ giá vào) = hướng lệnh, để tô vùng lãi / lỗi khi trỏ vào nút mờ. */
export type LineTag = { kind: "entry" | "tp" | "sl"; owner: TagOwner; qty: string; label: string; ghosts: ("tp" | "sl")[]; place?: string; draft: boolean; pending?: boolean; side?: "buy" | "sell" };
export type LineSpec = { key: string; price: number; color: string; style: LineStyleName; title: string; tag?: LineTag };

// Màu theo TradingView Paper Trading: Buy xanh dương, Sell đỏ, TP xanh lá, SL cam
export const COLORS = { buy: "#2962ff", sell: "#f23645", sl: "#ff9800", tp: "#089981" };
export const sideColor = (side: "buy" | "sell") => (side === "buy" ? COLORS.buy : COLORS.sell);

/** Đường đang kéo (lệnh chờ, SL/TP của vị thế / lệnh): vẽ ở giá xem trước với nhãn mới (loại lệnh sẽ thành nếu thả tay ở đó, hoặc số lãi/lỗi tại giá đó). `label` = chữ trên thẻ.
 *  `pending` = đã thả tay, đang chờ người dùng bấm ✓ xác nhận (thẻ hiện ✓ / ✕ thay cho ×). */
export type DragPreview = { key: string; price: number; title: string; label?: string; pending?: boolean };

/** Nhãn đường SL/TP: tên + lãi/lỗi dự kiến theo tiền account ("SL -12.40 USD"); callback do nơi dùng cấp (cần thông số symbol), thiếu thì chỉ "SL" / "TP". */
export type StopTitleFn = (kind: "sl" | "tp", side: "buy" | "sell", lot: number, entry: number, price: number, symbol: string) => string;

const plainStop: StopTitleFn = (kind) => kind.toUpperCase();

/** Chữ trên thẻ SL/TP: bỏ tên ("TP +20.00 USD" → "+20.00 USD"); chỉ có tên thì giữ nguyên. */
export const stopLabel = (title: string) => title.replace(/^(SL|TP)\s+/, "") || title;

/** Nút "TP" / "SL" mờ trên thẻ lệnh cho những mức chưa đặt. */
export const ghostsFor = (sl: number, tp: number): ("tp" | "sl")[] => [...(tp > 0 ? [] : (["tp"] as const)), ...(sl > 0 ? [] : (["sl"] as const))];

/** Đường trên chart của symbol hiện tại: entry + SL + TP của vị thế, giá + SL + TP của lệnh chờ. Dữ liệu cũ thì không có đường nào. `drag` đè giá + nhãn của các đường đang kéo
 *  hoặc chờ xác nhận (đường SL/TP chưa tồn tại mà đang được kéo ra từ nút mờ thì được dựng tạm). `ccy` = đơn vị tiền của account, ghi sau số lãi/lỗ của vị thế. */
export function tradeLines(data: TradeData | null, symbol: string, nowSec: number, drag?: DragPreview | DragPreview[] | null, stopTitle: StopTitleFn = plainStop, ccy = ""): LineSpec[] {
  if (!data || isStale(data, nowSec)) return [];
  const out: LineSpec[] = [];
  const drags = new Map((Array.isArray(drag) ? drag : drag ? [drag] : []).map((d) => [d.key, d] as const)); // nhiều đường cùng lúc (SL + TP chờ xác nhận); trùng khoá thì cái sau thắng
  const pending = (key: string, v: number) => (v > 0 ? v : (drags.get(key)?.price ?? 0)); // SL/TP chưa có nhưng đang được kéo ra
  const stops = (prefix: "p" | "o", owner: TagOwner, ticket: number, side: "buy" | "sell", lot: number, entry: number, slv: number, tpv: number) => {
    for (const [kind, v, color] of [["sl", slv, COLORS.sl], ["tp", tpv, COLORS.tp]] as const) {
      if (!(v > 0)) continue;
      const title = stopTitle(kind, side, lot, entry, v, symbol);
      out.push({ key: `${prefix}${kind}:${ticket}`, price: v, color, style: prefix === "p" ? "solid" : "dashed", title, tag: { kind, owner, qty: fmtLot(lot), label: stopLabel(title), ghosts: [], draft: false } });
    }
  };
  for (const p of data.positions) {
    if (p.symbol !== symbol || p.type === "other") continue;
    const buy = p.type === "buy";
    const side = buy ? "buy" : "sell";
    const owner: TagOwner = { t: "position", ticket: p.ticket };
    const sl = pending(`psl:${p.ticket}`, p.sl);
    const tp = pending(`ptp:${p.ticket}`, p.tp);
    const pnl = fmtPnl(positionPnl(p));
    out.push({
      key: `p:${p.ticket}`,
      price: p.price_open,
      color: sideColor(side),
      style: "solid",
      title: `${buy ? "BUY" : "SELL"} ${fmtLot(p.volume)}  ${pnl}`,
      tag: { kind: "entry", owner, qty: fmtLot(p.volume), label: ccy ? `${pnl} ${ccy}` : pnl, ghosts: ghostsFor(sl, tp), draft: false, side },
    });
    stops("p", owner, p.ticket, side, p.volume, p.price_open, sl, tp);
  }
  for (const o of data.orders) {
    if (o.symbol !== symbol || o.price_open <= 0) continue;
    const side = o.type.startsWith("buy") ? "buy" : "sell";
    const owner: TagOwner = { t: "order", ticket: o.ticket };
    const sl = pending(`osl:${o.ticket}`, o.sl);
    const tp = pending(`otp:${o.ticket}`, o.tp);
    out.push({
      key: `o:${o.ticket}`,
      price: o.price_open,
      color: sideColor(side),
      style: "dashed",
      title: `${orderLabel(o.type).toUpperCase()} ${fmtLot(o.volume)}`,
      tag: { kind: "entry", owner, qty: fmtLot(o.volume), label: orderLabel(o.type), ghosts: ghostsFor(sl, tp), draft: false, side },
    });
    stops("o", owner, o.ticket, side, o.volume, o.price_open, sl, tp);
  }
  if (drags.size === 0) return out;
  return out.map((l) => {
    const drag = drags.get(l.key);
    if (!drag) return l;
    const label = drag.label ?? (l.tag && l.tag.kind !== "entry" ? stopLabel(drag.title) : l.tag?.label);
    const tag = l.tag && { ...l.tag, ...(label !== undefined ? { label } : {}), ...(drag.pending ? { pending: true } : {}) };
    return { ...l, price: drag.price, title: drag.title, tag };
  });
}
