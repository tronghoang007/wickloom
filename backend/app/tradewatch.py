"""Báo vị thế chạm SL / TP, bị stop out và lệnh chờ khớp (docs/alerts-plan.md Phase 3, mục 2). Nguồn là các thông điệp EA đã gửi: `trade` (vị thế + lệnh chờ hiện tại) và `deals`
(lịch sử khớp lệnh, mỗi deal có `reason` sl / tp / so và `order`). Deal là nguồn sự thật: deal đóng (`entry` out) với reason sl / tp / so là chạm SL / TP / stop out; deal mở (`entry` in)
mà `order` là một lệnh chờ đã thấy là lệnh chờ khớp (lệnh thị trường không từng nằm trong danh sách lệnh chờ).

Mốc `last_ticket` (ticket deal tăng dần theo account) và các lệnh chờ đã thấy lưu trong `trade_watch` nên khởi động lại backend vẫn báo bù những deal xảy ra lúc tắt (gắn "(trễ)"), còn lịch sử
cũ lúc mới thấy một account chỉ làm mốc, không báo. Mốc luôn chạy cả khi chưa ai bật quy tắc `trade`, nên bật sau không bị báo dồn deal cũ. Tin gửi cho mọi user đã bật quy tắc (rules.py): MT5 là
một cửa sổ dùng chung, mọi user đều thấy account đang kết nối."""
import json
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import alerts, mt5, notify, rules, state

LATE_AFTER = 180  # deal cũ hơn chừng này giây lúc backend thấy -> "(trễ)"
MAX_AGE = 86400  # deal cũ hơn thế (backend tắt cả ngày) không báo nữa
GONE_KEEP = 3 * 86400  # lệnh chờ đã biến mất vẫn nhớ chừng này để báo bù lệnh khớp lúc tắt
MERGE_OVER = 3  # nhiều hơn chừng này sự kiện trong một lô thì gộp thành một tin
BASELINE_WAIT = 120  # account mới thấy mà thông điệp deal đầu tiên rỗng: chờ chừng này giây cho lịch sử của terminal về rồi mới lấy mốc (không thì cả lịch sử bị báo như deal mới)
ORDER_LABEL = {"buy_limit": "Buy limit", "sell_limit": "Sell limit", "buy_stop": "Buy stop", "sell_stop": "Sell stop", "buy_stop_limit": "Buy stop limit", "sell_stop_limit": "Sell stop limit"}
TITLES = {"sl": "SL hit", "tp": "TP hit", "so": "Stop out", "fill": "Pending order filled"}

with state.meta.tx() as _db:
    _db.execute("CREATE TABLE IF NOT EXISTS trade_watch (account_id TEXT PRIMARY KEY, last_ticket INTEGER, orders TEXT NOT NULL DEFAULT '{}')")


def _fmt(p: float) -> str:
    return f"{p:.10g}"


class TradeWatcher:
    def __init__(self, submit: Callable[[notify.Fired], None], users: Callable[[], List[Tuple[str, Dict[str, Any]]]], account: Callable[[str], Optional[Dict[str, Any]]],
                 clock: Callable[[], float] = time.time):
        self.submit = submit
        self.users = users
        self.account = account
        self.clock = clock
        self._last: Dict[str, int] = {}
        self._orders: Dict[str, Dict[int, Dict[str, Any]]] = {}  # ticket lệnh chờ -> {type, symbol, volume, gone: giờ biến mất hoặc 0 nếu còn}
        self._sig: Dict[str, Tuple[int, ...]] = {}
        self._born: Dict[str, float] = {}  # lúc thấy account lần đầu (chỉ trong bộ nhớ)

    # --- trạng thái bền -------------------------------------------------------------------------------------------------------------------------------------

    def _load(self, aid: str) -> None:
        if aid in self._orders:
            return
        with state.meta._lock:
            row = state.meta.db.execute("SELECT last_ticket, orders FROM trade_watch WHERE account_id=?", (aid,)).fetchone()
        self._orders[aid] = {int(k): v for k, v in json.loads(row[1]).items()} if row else {}
        if row and row[0] is not None:  # NULL = mới thấy lệnh chờ, chưa thấy lịch sử deal: lần deal đầu vẫn là mốc
            self._last[aid] = row[0]

    def _save(self, aid: str) -> None:
        with state.meta.tx() as db:
            db.execute("INSERT INTO trade_watch (account_id, last_ticket, orders) VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET last_ticket=excluded.last_ticket, orders=excluded.orders",
                       (aid, self._last.get(aid), json.dumps({str(k): v for k, v in self._orders[aid].items()})))

    # --- thông điệp EA --------------------------------------------------------------------------------------------------------------------------------------

    def on_update(self, aid: str, mtype: str, t: Dict[str, Any]) -> None:
        self._load(aid)
        if mtype == "trade":
            self._on_orders(aid, t["orders"])
        else:
            self._on_deals(aid, t["deals"])

    def _on_orders(self, aid: str, orders: List[Dict[str, Any]]) -> None:
        sig = tuple(sorted(o["ticket"] for o in orders))
        if self._sig.get(aid) == sig:  # `trade` đến mỗi giây: chỉ làm việc khi tập lệnh chờ đổi
            return
        self._sig[aid] = sig
        now = self.clock()
        known = self._orders[aid]
        for o in orders:
            known[o["ticket"]] = {"type": o["type"], "symbol": o["symbol"], "volume": o["volume"], "gone": 0}
        for tk, o in known.items():
            if tk not in sig and not o["gone"]:
                o["gone"] = int(now)  # khớp hay bị huỷ: deal (nếu có) sẽ cho biết
        for tk in [tk for tk, o in known.items() if o["gone"] and now - o["gone"] > GONE_KEEP]:
            del known[tk]
        self._save(aid)

    def _on_deals(self, aid: str, deals: List[Dict[str, Any]]) -> None:
        top = max((d["ticket"] for d in deals), default=0)
        last = self._last.get(aid)
        if last is None:  # lần đầu thấy account này: lịch sử có sẵn chỉ làm mốc
            if not deals and self.clock() - self._born.setdefault(aid, self.clock()) <= BASELINE_WAIT:
                return  # rỗng: có thể terminal chưa nạp xong lịch sử, đừng lấy mốc 0 kẻo lịch sử về sau bị báo hết
            self._last[aid] = top
            self._save(aid)
            return
        fresh = sorted((d for d in deals if d["ticket"] > last), key=lambda d: d["ticket"])
        if not fresh:
            return
        self._last[aid] = max(last, top)
        self._save(aid)
        now = self.clock()
        events = [e for e in (self._event(aid, d, now) for d in fresh) if e]
        if events:
            self._notify(aid, events, now)

    # --- sự kiện --------------------------------------------------------------------------------------------------------------------------------------------

    def _event(self, aid: str, d: Dict[str, Any], now: float) -> Optional[Dict[str, Any]]:
        """Một deal -> sự kiện cần báo (hoặc None). `kind` là khoá của `TITLES`."""
        if d["type"] not in ("buy", "sell") or now - d["time"] > MAX_AGE:
            return None
        if d["entry"] in ("out", "inout") and d["reason"] in ("sl", "tp", "so"):
            kind = d["reason"]
            side = "SELL" if d["type"] == "buy" else "BUY"  # deal đóng nằm phía ngược với vị thế
            net = d["profit"] + d["swap"] + d["commission"]
            cur = (self.account(aid) or {}).get("currency", "")
            text = f"{side} {d['volume']:g} {d['symbol']} closed at {_fmt(d['price'])} · P/L {net:+.2f} {cur}".rstrip() + f" · #{d['position']}"
        elif d["entry"] == "in" and d["order"] in self._orders[aid]:
            o = self._orders[aid][d["order"]]
            kind = "fill"
            text = f"{ORDER_LABEL.get(o['type'], o['type'])} {d['volume']:g} {d['symbol']} filled at {_fmt(d['price'])} · #{d['order']}"
        else:
            return None
        late = now - d["time"] > LATE_AFTER
        return {"kind": kind, "line": f"(trễ) {text}" if late else text, "time": d["time"]}

    def _notify(self, aid: str, events: List[Dict[str, Any]], now: float) -> None:
        info = self.account(aid) or {}
        who = f"{str(info.get('mode', '')).capitalize()} #{info['login']}".strip() if info.get("login") else ""
        for user_id, cfg in self.users():
            mine = [e for e in events if e["kind"] == "so" or cfg.get(e["kind"], True)]
            if not mine:
                continue
            if len(mine) > MERGE_OVER:
                self.submit(notify.notice(user_id, "trade", f"{len(mine)} trade events", "\n".join(e["line"] for e in mine), cfg["channels"], max(e["time"] for e in mine), message=who))
                continue
            for e in mine:
                self.submit(notify.notice(user_id, "trade", TITLES[e["kind"]], e["line"], cfg["channels"], e["time"], message=who))


def _account(aid: str) -> Optional[Dict[str, Any]]:
    return mt5.registry.info(aid)


watcher = TradeWatcher(alerts.dispatcher.submit, lambda: rules.enabled("trade"), _account)
mt5.registry.listeners.append(watcher.on_update)
