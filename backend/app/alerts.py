"""Alert giá đa kênh (docs/alerts-plan.md). Backend là nơi so điều kiện trên từng tick EA gửi (không phải trình duyệt) nên alert vẫn nổ khi tắt hết tab; thông báo ra web
(WebSocket), Telegram và điện thoại qua MT5 (notify.py). Bảng riêng trong meta.sqlite, KHÔNG nằm trong `TABLES` của store.py vì CRUD generic của bảng đó mở cho ai cũng ghi
(xem ghi chú đầu economic.py). Chủ sở hữu luôn lấy từ phiên đăng nhập; id của user khác -> 404 như chưa từng tồn tại (giống me.py).

Điều kiện so với CÙNG giá mà chart dựng nến (bid, hoặc last nếu symbol theo Last: `price = bid or last` ở tcp_server), nên đường alert trên chart khớp với nến thấy được."""
import json
import math
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from . import config, geometry, indicators, mt5, notify, state
from .aggregator import bar_open
from .auth import current_user
from .config import TF_SECONDS
from .notify import Fired

CONDS = ("cross", "cross_up", "cross_down", "gt", "lt", "enter", "exit", "inside", "outside")  # 4 điều kiện sau chỉ cho dải giá của kênh / hình chữ nhật (geometry.BAND_CONDS)
TRIGGERS = ("once", "once_per_bar", "once_per_bar_close", "every_time")
CHANNEL_KEYS = ("web", "telegram", "mt5")
MAX_LIVE = 100  # alert đang chạy hoặc tạm dừng mỗi user
MAX_NAME = 60
MAX_MESSAGE = 200
LOG_KEEP = 500  # dòng nhật ký giữ lại mỗi user
REFIRE_GAP = 5.0  # "every_time" nổ lại tối đa mỗi chừng này giây (giá dao động quanh mức không được làm ngập Telegram)
# Báo bù (mục 3 của Phase 3): alert không thấy tick nào quá CATCHUP_GAP giây rồi lại có tick (backend / EA / mạng tắt) thì soát nến M1 của khoảng đứt xem giá có chạm mức không.
CATCHUP_GAP = 120
CATCHUP_SETTLE = 3.0  # nến M1 hết đổ về chừng này giây thì coi là EA nạp xong
CATCHUP_WAIT = 90.0  # tối đa chờ EA nạp nến (EA tắt lại / nạp hỏng) rồi soát với những gì đang có
CATCHUP_MAX = 3 * 86400  # chỉ soát chừng này giây gần nhất của khoảng đứt
IND_EVERY = 2.0  # alert theo indicator được xét chừng này giây một lần
CHECKPOINT_EVERY = 5.0  # ghi mốc "đã đánh giá tới đâu" của alert xuống DB nhiều nhất chừng này giây một lần
TEST_GAP = 3.0  # nút "Gửi thử": giãn cách giữa hai lần của cùng user + kênh

COLS = ("id", "user_id", "symbol", "cond", "level", "trig", "tf", "expires_at", "name", "message", "channels", "state", "created_at", "fired_at", "fire_count", "drawing", "checked_at", "indicator")

with state.meta.tx() as _db:
    _db.execute(
        "CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, symbol TEXT NOT NULL, cond TEXT NOT NULL, level REAL NOT NULL, "
        "trig TEXT NOT NULL DEFAULT 'once', tf TEXT NOT NULL DEFAULT 'M1', expires_at INTEGER, name TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '', "
        "channels TEXT NOT NULL DEFAULT '{}', state TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, fired_at INTEGER, fire_count INTEGER NOT NULL DEFAULT 0)"
    )
    _db.execute("CREATE INDEX IF NOT EXISTS alerts_user ON alerts(user_id)")
    _db.execute(
        "CREATE TABLE IF NOT EXISTS alert_log (id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id TEXT NOT NULL, user_id TEXT NOT NULL, time INTEGER NOT NULL, symbol TEXT NOT NULL, "
        "name TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '', cond TEXT NOT NULL, level REAL NOT NULL, price REAL NOT NULL, results TEXT NOT NULL DEFAULT '{}')"
    )
    _db.execute("CREATE INDEX IF NOT EXISTS alert_log_user ON alert_log(user_id, id)")
    # Cột thêm ở Phase 2 (alert trên hình vẽ): DB đã có từ Phase 1 thì thêm vào bảng cũ
    if "drawing" not in {r[1] for r in _db.execute("PRAGMA table_info(alerts)")}:
        _db.execute("ALTER TABLE alerts ADD COLUMN drawing TEXT")
    if "indicator" not in {r[1] for r in _db.execute("PRAGMA table_info(alerts)")}:  # Phase 3: alert theo indicator (indicators.clean_spec)
        _db.execute("ALTER TABLE alerts ADD COLUMN indicator TEXT")
    if "checked_at" not in {r[1] for r in _db.execute("PRAGMA table_info(alerts)")}:  # Phase 3: giờ tick cuối alert đã được đánh giá (báo bù); NULL = alert cũ, không báo bù
        _db.execute("ALTER TABLE alerts ADD COLUMN checked_at INTEGER")
    if "label" not in {r[1] for r in _db.execute("PRAGMA table_info(alert_log)")}:
        _db.execute("ALTER TABLE alert_log ADD COLUMN label TEXT NOT NULL DEFAULT ''")
    # Cột thêm ở Phase 3: loại tin (alert giá / tin kinh tế / giao dịch), nội dung của tin không phải alert giá, cờ báo bù
    _log_cols = {r[1] for r in _db.execute("PRAGMA table_info(alert_log)")}
    for _col, _ddl in (("kind", "TEXT NOT NULL DEFAULT 'price'"), ("text", "TEXT NOT NULL DEFAULT ''"), ("late", "INTEGER NOT NULL DEFAULT 0")):
        if _col not in _log_cols:
            _db.execute(f"ALTER TABLE alert_log ADD COLUMN {_col} {_ddl}")
    _db.execute("CREATE TABLE IF NOT EXISTS notify_channels (user_id TEXT NOT NULL, kind TEXT NOT NULL, config TEXT NOT NULL, PRIMARY KEY (user_id, kind))")


@dataclass
class Alert:
    id: str
    user_id: str
    symbol: str
    cond: str
    level: float
    trigger: str
    tf: str
    expires_at: Optional[int]
    name: str
    message: str
    channels: Dict[str, bool]
    state: str
    created_at: int
    fired_at: Optional[int] = None
    fire_count: int = 0
    drawing: Optional[Dict[str, Any]] = None  # bản sao hình vẽ (geometry.clean_spec); None = alert theo mức giá cố định `level`
    checked_at: Optional[int] = None  # giờ (UTC giây) của tick cuối đã đánh giá, hoặc lúc tạo / sửa: mốc đầu của đoạn cần báo bù
    indicator: Optional[Dict[str, Any]] = None  # alert theo indicator (indicators.clean_spec): so một đường của indicator với `level` / giá / đường khác; None = alert giá
    # Chỉ trong bộ nhớ: backend khởi động lại thì đặt lại, nên không bao giờ bắn nhầm vì một mốc cũ.
    ref: Optional[float] = field(default=None, repr=False)  # giá tick trước, mốc để phát hiện cắt
    ref_close: Optional[float] = field(default=None, repr=False)  # giá đóng nến trước ("once_per_bar_close")
    last_bar: Optional[int] = field(default=None, repr=False)  # nến đã nổ ("once_per_bar")
    last_fire: float = field(default=0.0, repr=False)
    flushed: Optional[int] = field(default=None, repr=False)  # `checked_at` đã ghi xuống DB
    catch: Optional[Tuple[int, int, float]] = field(default=None, repr=False)  # đang chờ báo bù: (đầu khoảng đứt, giờ tick đầu sau khoảng đứt, giờ phát hiện)
    # Alert theo indicator, chỉ trong bộ nhớ: mốc nến đã đóng đã xét ("đóng nến"), `checked_at` lúc nạp (chưa bị tick mới ghi đè), giá trị lần xét trước (đường, thứ được so) và khoá để khỏi tính lại khi chưa gì đổi
    ind_bar: Optional[int] = field(default=None, repr=False)
    ind_since: Optional[int] = field(default=None, repr=False)
    ind_ref_b: Optional[float] = field(default=None, repr=False)
    ind_key: Optional[Tuple[float, int]] = field(default=None, repr=False)
    # Alert trên hình vẽ, chỉ trong bộ nhớ: dải giá [lo, hi] của hình ở nến hiện tại (tính lại mỗi nến), trạng thái hình học ("ok" / "wait" / "done") và mốc trước đó
    geo_bar: Optional[int] = field(default=None, repr=False)
    geo_state: str = field(default="wait", repr=False)
    band: Optional[Tuple[float, float]] = field(default=None, repr=False)
    ref_band: Optional[Tuple[float, float]] = field(default=None, repr=False)
    ref_close_band: Optional[Tuple[float, float]] = field(default=None, repr=False)

    def public(self, with_user: bool = False) -> Dict[str, Any]:
        d = {"id": self.id, "symbol": self.symbol, "cond": self.cond, "level": self.level, "trigger": self.trigger, "tf": self.tf, "expires_at": self.expires_at,
             "name": self.name, "message": self.message, "channels": dict(self.channels), "state": self.state, "created_at": self.created_at,
             "fired_at": self.fired_at, "fire_count": self.fire_count, "drawing": self.drawing, "indicator": self.indicator}
        if with_user:
            d["user_id"] = self.user_id
        return d


def _from_row(r: Any) -> Alert:
    d = dict(zip(COLS, r))
    d["trigger"] = d.pop("trig")
    chans = json.loads(d["channels"])
    d["channels"] = {k: bool(chans.get(k)) for k in CHANNEL_KEYS}
    d["drawing"] = json.loads(d["drawing"]) if d["drawing"] else None
    d["indicator"] = json.loads(d["indicator"]) if d["indicator"] else None
    return Alert(**d)


def _query(sql: str, args: Iterable[Any] = ()) -> List[Any]:
    with state.meta._lock:
        return state.meta.db.execute(sql, tuple(args)).fetchall()


def db_get(user_id: str, alert_id: str) -> Optional[Alert]:
    rows = _query(f"SELECT {','.join(COLS)} FROM alerts WHERE id=? AND user_id=?", (alert_id, user_id))
    return _from_row(rows[0]) if rows else None


def db_active() -> List[Alert]:
    return [_from_row(r) for r in _query(f"SELECT {','.join(COLS)} FROM alerts WHERE state='active'")]


def db_list(user_id: str) -> List[Alert]:
    return [_from_row(r) for r in _query(f"SELECT {','.join(COLS)} FROM alerts WHERE user_id=? ORDER BY created_at DESC, id", (user_id,))]


def db_live_count(user_id: str) -> int:
    return _query("SELECT COUNT(*) FROM alerts WHERE user_id=? AND state IN ('active','paused')", (user_id,))[0][0]


def db_save(a: Alert) -> None:
    vals = (a.id, a.user_id, a.symbol, a.cond, a.level, a.trigger, a.tf, a.expires_at, a.name, a.message, json.dumps(a.channels), a.state, a.created_at, a.fired_at, a.fire_count,
            json.dumps(a.drawing) if a.drawing else None, a.checked_at, json.dumps(a.indicator) if a.indicator else None)
    with state.meta.tx() as db:
        db.execute(f"INSERT INTO alerts ({','.join(COLS)}) VALUES ({','.join('?' * len(COLS))}) ON CONFLICT(id) DO UPDATE SET "
                   + ",".join(f"{c}=excluded.{c}" for c in COLS[1:]), vals)


def db_persist_fire(a: Alert) -> None:
    """Engine chỉ ghi các cột nó đổi: sửa alert từ API cùng lúc không bị đè."""
    with state.meta.tx() as db:
        db.execute("UPDATE alerts SET state=?, fired_at=?, fire_count=? WHERE id=?", (a.state, a.fired_at, a.fire_count, a.id))


def db_checkpoint(rows: List[Tuple[int, str]]) -> None:
    """(checked_at, id) của các alert vừa được đánh giá tiếp: ghi gộp một lần."""
    with state.meta.tx() as db:
        db.executemany("UPDATE alerts SET checked_at=? WHERE id=? AND state='active'", rows)


def db_delete(user_id: str, alert_id: str) -> bool:
    with state.meta.tx() as db:
        return db.execute("DELETE FROM alerts WHERE id=? AND user_id=?", (alert_id, user_id)).rowcount > 0


def log_add(f: Fired) -> int:
    a = f.alert
    with state.meta.tx() as db:
        cur = db.execute(
            "INSERT INTO alert_log (alert_id, user_id, time, symbol, name, message, cond, level, price, label, kind, text, late) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (a["id"], a["user_id"], f.time, a["symbol"], a["name"], a["message"], a["cond"], a["level"], f.price, (a.get("drawing") or {}).get("label", ""), f.kind,
             f.line or (notify.condition_text(a) if a.get("indicator") else ""), int(f.late)),
        )
        db.execute("DELETE FROM alert_log WHERE user_id=? AND id NOT IN (SELECT id FROM alert_log WHERE user_id=? ORDER BY id DESC LIMIT ?)", (a["user_id"], a["user_id"], LOG_KEEP))
        return int(cur.lastrowid)


def log_set(log_id: int, results: Dict[str, str]) -> None:
    with state.meta.tx() as db:
        db.execute("UPDATE alert_log SET results=? WHERE id=?", (json.dumps(results), log_id))


def log_list(user_id: str, limit: int) -> List[Dict[str, Any]]:
    cols = ("id", "alert_id", "time", "symbol", "name", "message", "cond", "level", "price", "label", "kind", "text", "late", "results")
    rows = _query(f"SELECT {','.join(cols)} FROM alert_log WHERE user_id=? ORDER BY id DESC LIMIT ?", (user_id, limit))
    return [{**dict(zip(cols, r)), "late": bool(r[-2]), "results": json.loads(r[-1])} for r in rows]


def channel_get(user_id: str, kind: str) -> Optional[Dict[str, Any]]:
    rows = _query("SELECT config FROM notify_channels WHERE user_id=? AND kind=?", (user_id, kind))
    return json.loads(rows[0][0]) if rows else None


def channel_set(user_id: str, kind: str, cfg: Dict[str, Any]) -> None:
    with state.meta.tx() as db:
        db.execute("INSERT INTO notify_channels (user_id, kind, config) VALUES (?,?,?) ON CONFLICT(user_id, kind) DO UPDATE SET config=excluded.config", (user_id, kind, json.dumps(cfg)))


def channel_delete(user_id: str, kind: str) -> None:
    with state.meta.tx() as db:
        db.execute("DELETE FROM notify_channels WHERE user_id=? AND kind=?", (user_id, kind))


def hit(cond: str, level: float, prev: Optional[float], p: float, prev_level: Optional[float] = None) -> bool:
    """Điều kiện với giá mới `p` và giá liền trước `prev` (None = chưa có mốc: điều kiện cắt không bao giờ đúng ở tick đầu, tick đó chỉ làm mốc).
    Cắt lên = prev < mức <= p, cắt xuống = prev > mức >= p, nên tick nhảy qua mức vẫn tính (giá đứt rồi nối lại). Mức của đường trên hình vẽ đổi theo nến:
    `prev_level` = mức lúc có `prev` (mặc định bằng `level`), nên đường dịch qua giá đứng yên cũng là một lần cắt, như trên chart."""
    d = p - level
    pd = None if prev is None else prev - (level if prev_level is None else prev_level)
    if cond == "gt":
        return d > 0
    if cond == "lt":
        return d < 0
    up = pd is not None and pd < 0 <= d
    down = pd is not None and pd > 0 >= d
    return up if cond == "cross_up" else down if cond == "cross_down" else (up or down)


def touch(cond: str, level: float, prev: Optional[float], bar: Dict[str, Any]) -> bool:
    """Nến M1 `bar` (khi `prev` = giá đóng nến liền trước) có chạm điều kiện không: dùng để báo bù, chỉ biết khoảng giá của từng phút nên hơi rộng hơn `hit` trên từng tick.
    Cắt lên = prev < mức <= đỉnh nến, cắt xuống = prev > mức >= đáy nến; gt / lt chỉ cần đỉnh / đáy nến vượt mức."""
    if cond == "gt":
        return bar["h"] > level
    if cond == "lt":
        return bar["l"] < level
    p = bar["o"] if prev is None else prev
    up, down = p < level <= bar["h"], p > level >= bar["l"]
    return up if cond == "cross_up" else down if cond == "cross_down" else (up or down)


class Engine:
    """Giữ alert đang chạy trong bộ nhớ theo symbol (chỉ đọc DB khi nạp và khi API đổi), so điều kiện trên từng tick / nến đóng.
    `on_price` chạy trên event loop của tick: không mạng, không chờ lâu. Việc giao thông báo giao cho `fire` (hàng đợi của Dispatcher)."""

    def __init__(self, fire: Callable[[Fired], None], persist: Callable[[Alert], None], clock: Callable[[], float] = time.time,
                 logical: Optional[Callable[[str, str, List[int], int, int], Optional[Tuple[List[float], float]]]] = None,
                 bars: Optional[Callable[[str, int, int], List[Dict[str, Any]]]] = None, request: Optional[Callable[[str], None]] = None,
                 checkpoint: Optional[Callable[[List[Tuple[int, str]]], None]] = None,
                 history: Optional[Callable[[str, str, int], List[Dict[str, Any]]]] = None, live: Optional[Callable[[str, str], Optional[Dict[str, Any]]]] = None):
        self.fire = fire
        self.persist = persist
        self.clock = clock
        self.logical = logical or (lambda symbol, tf, times, step, now_bar: state.bars.logical(symbol, tf, times, step, now_bar))  # chỉ số nến của điểm neo hình vẽ (BarStore.logical)
        self.bars = bars or (lambda symbol, lo, hi: state.bars.query(symbol, "M1", lo, hi, limit=CATCHUP_MAX // 60 + 1))  # nến M1 trong [lo, hi) để báo bù
        self.request = request or (lambda symbol: state.request_catchup(symbol, "M1"))  # xin EA nạp nến M1 của khoảng đứt
        self.checkpoint = checkpoint or db_checkpoint
        self.history = history or (lambda symbol, tf, count: state.bars.query(symbol, tf, limit=count))  # `count` nến mới nhất của (symbol, tf), tăng dần (có thể gồm nến đang chạy)
        self.live = live or (lambda symbol, tf: state.aggregator.cur.get((symbol, tf)))  # nến đang chạy do aggregator gom từ tick
        self._lock = threading.RLock()
        self._by_symbol: Dict[str, List[Alert]] = {}
        self._bars_seen: Dict[str, float] = {}  # symbol -> lúc nhận thông điệp nến M1 gần nhất từ EA
        self._last: Dict[str, Tuple[int, float]] = {}  # symbol -> (giờ, giá) của tick mới nhất: alert theo indicator xét theo giá này

    def symbols(self) -> Set[str]:
        return {s for s, lst in list(self._by_symbol.items()) if lst}

    def bar_pairs(self) -> Set[Tuple[str, str]]:
        """(symbol, tf) mà alert trên hình vẽ cần có nến đầy đủ trong DB (đếm chỉ số nến): khi EA nối lại thì xin nạp bù."""
        return {(a.symbol, a.tf) for lst in list(self._by_symbol.values()) for a in lst if a.drawing or a.indicator}

    def history_needs(self) -> Dict[Tuple[str, str], int]:
        """(symbol, tf) -> số nến đã đóng cần có trong DB để indicator của alert hội tụ (alert theo indicator)."""
        out: Dict[Tuple[str, str], int] = {}
        for lst in list(self._by_symbol.values()):
            for a in lst:
                if a.indicator:
                    out[(a.symbol, a.tf)] = max(out.get((a.symbol, a.tf), 0), indicators.history_need(a.indicator))
        return out

    def sync(self, alert_id: str, new: Optional[Alert]) -> None:
        """Thay alert `alert_id` trong bộ nhớ bằng `new` (None = bỏ). Chỉ alert active mới ở lại; mốc giá đặt lại."""
        with self._lock:
            for lst in self._by_symbol.values():
                lst[:] = [a for a in lst if a.id != alert_id]
            if new is not None and new.state == "active":
                new.flushed = new.checked_at
                new.ind_since = new.checked_at
                self._by_symbol.setdefault(new.symbol, []).append(new)
                if new.trigger == "once_per_bar_close" or new.drawing or new.indicator:
                    state.aggregator.watch(new.symbol, new.tf)  # nến đóng của TF này phải được dựng dù không chart nào xem

    def load(self, alerts: Iterable[Alert]) -> None:
        for a in alerts:
            self.sync(a.id, a)

    def _finish(self, a: Alert, new_state: str) -> None:
        a.state = new_state
        lst = self._by_symbol.get(a.symbol)
        if lst is not None:
            lst[:] = [x for x in lst if x.id != a.id]

    def _fired(self, a: Alert, price: float, now: float, late_at: Optional[int] = None, values: Optional[Tuple[float, float]] = None) -> Fired:
        """`late_at`: báo bù, giờ (UTC giây) của nến đã chạm mức; thông báo mang giờ đó và nhãn "(trễ)". `values`: (đường indicator, thứ được so) lúc nổ."""
        a.fire_count += 1
        a.fired_at = int(now)
        a.last_fire = now
        if a.trigger == "once":
            self._finish(a, "triggered")
        snap = a.public(with_user=True)
        if a.drawing and a.band:
            snap["now"] = list(a.band)  # dải giá của hình lúc nổ (cho nội dung thông báo)
        if values is not None:
            snap["now"] = list(values)
        return Fired(snap, price, int(now) if late_at is None else late_at, late=late_at is not None)

    def _refresh_geo(self, a: Alert, bar: int) -> None:
        """Dải giá của hình ở nến `bar` (chỉ đổi khi sang nến mới nên không tính mỗi tick)."""
        a.geo_bar = bar
        res = self.logical(a.symbol, a.tf, [t for t, _ in a.drawing["pts"]], TF_SECONDS[a.tf], bar)  # type: ignore[index]
        if res is None:
            a.geo_state, a.band = "wait", None
            return
        a.geo_state, lo, hi = geometry.geometry(a.drawing, res[0], res[1])  # type: ignore[arg-type]
        a.band = (lo, hi) if a.geo_state == "ok" else None
        if a.band:
            a.level = (lo + hi) / 2

    def _hit(self, a: Alert, prev: Optional[float], prev_band: Optional[Tuple[float, float]], price: float) -> bool:
        if a.drawing is None:
            return hit(a.cond, a.level, prev, price)
        if a.band is None:
            return False
        if geometry.kind_of(a.drawing) == "line":
            return hit(a.cond, a.band[0], prev if prev_band else None, price, prev_band[0] if prev_band else None)
        return geometry.hit_band(a.cond, prev, prev_band, price, a.band)

    def _run(self, fn: Callable[[], None]) -> None:
        try:
            fn()
        except Exception as exc:  # alert lỗi không được làm hỏng luồng tick / nến
            print(f"alert engine loi: {type(exc).__name__}: {exc}")

    def on_price(self, symbol: str, t_msc: int, price: float, offset: int) -> None:
        if not self._by_symbol.get(symbol):
            return
        self._last[symbol] = (t_msc // 1000, price)
        self._run(lambda: self._on_price(symbol, t_msc, price, offset))

    def _on_price(self, symbol: str, t_msc: int, price: float, offset: int) -> None:
        now = self.clock()
        fired: List[Fired] = []
        changed: List[Alert] = []
        gapped = False
        with self._lock:
            for a in list(self._by_symbol.get(symbol, ())):
                gapped = self._note_tick(a, t_msc // 1000, now) or gapped
                if a.indicator:  # xét ở thread nền (eval_indicators), không trên event loop của tick
                    continue
                if a.drawing and a.geo_bar != bar_open(t_msc // 1000, a.tf, offset):
                    self._refresh_geo(a, bar_open(t_msc // 1000, a.tf, offset))
                prev, a.ref = a.ref, price
                prev_band, a.ref_band = a.ref_band, a.band
                if a.expires_at and now >= a.expires_at:
                    self._finish(a, "expired")
                    changed.append(a)
                    continue
                if a.drawing and a.geo_state == "done":  # hình đã kết thúc và không kéo dài sang phải
                    self._finish(a, "expired")
                    changed.append(a)
                    continue
                if a.trigger == "once_per_bar_close" or not self._hit(a, prev, prev_band, price):
                    continue
                if a.trigger == "once_per_bar":
                    bar = bar_open(t_msc // 1000, a.tf, offset)
                    if a.last_bar == bar:
                        continue
                    a.last_bar = bar
                elif a.trigger == "every_time" and now - a.last_fire < REFIRE_GAP:
                    continue
                fired.append(self._fired(a, price, now))
                changed.append(a)
        self._emit(fired, changed)
        if gapped:
            self.request(symbol)  # ngoài khoá: gửi lệnh xuống EA

    def on_bar_close(self, symbol: str, tf: str, bar: Dict[str, Any]) -> None:
        if not self._by_symbol.get(symbol):
            return
        self._run(lambda: self._on_bar_close(symbol, tf, bar))

    def _on_bar_close(self, symbol: str, tf: str, bar: Dict[str, Any]) -> None:
        now = self.clock()
        close = float(bar["c"])
        fired: List[Fired] = []
        changed: List[Alert] = []
        with self._lock:
            for a in list(self._by_symbol.get(symbol, ())):
                if a.trigger != "once_per_bar_close" or a.tf != tf or a.indicator:
                    continue
                prev, a.ref_close = a.ref_close, close
                prev_band, a.ref_close_band = a.ref_close_band, a.band if a.geo_bar == bar["t"] else None  # dải của chính nến vừa đóng
                if a.expires_at and now >= a.expires_at:
                    self._finish(a, "expired")
                    changed.append(a)
                elif self._hit_close(a, prev, prev_band, close, bar["t"]):
                    fired.append(self._fired(a, close, now))
                    changed.append(a)
        self._emit(fired, changed)

    def _hit_close(self, a: Alert, prev: Optional[float], prev_band: Optional[Tuple[float, float]], close: float, bar_t: int) -> bool:
        if a.drawing is None:
            return hit(a.cond, a.level, prev, close)
        return a.geo_bar == bar_t and self._hit(a, prev, prev_band, close)

    # --- báo bù lần giá chạm lúc không có tick -------------------------------------------------------------------------------------------------------------

    def _note_tick(self, a: Alert, t: int, now: float) -> bool:
        """Tick giờ `t` tới alert `a`: cập nhật mốc đã đánh giá. True nếu vừa hết một khoảng đứt dài (cần soát nến M1 của khoảng đó). Chỉ alert theo mức giá cố định
        và không phải "đóng nến" mới báo bù bằng nến M1 được (đường trên hình vẽ đổi mức theo từng nến, "đóng nến" xét giá đóng của khung riêng, indicator tự bù theo nến đóng)."""
        gap = a.checked_at is not None and t - a.checked_at > CATCHUP_GAP and a.catch is None and a.drawing is None and a.indicator is None and a.trigger != "once_per_bar_close"
        if gap:
            a.catch = (a.checked_at, t, now)
        if a.checked_at is None or t > a.checked_at:
            a.checked_at = t
        return gap

    def on_bars(self, symbol: str) -> None:
        """EA vừa gửi nến M1 của `symbol` (tcp_server): ghi giờ để biết khi nào việc nạp bù đã lắng xuống."""
        self._bars_seen[symbol] = self.clock()

    def _catch_up(self, a: Alert, now: float) -> Optional[Fired]:
        """Soát nến M1 của khoảng đứt xem giá có chạm mức của `a` không; nổ tối đa một lần (giờ nến chạm đầu tiên). Bắt đầu từ nến SAU nến của lần đánh giá cuối (nến đó phần lớn đã được
        đánh giá trực tiếp nên soát lại sẽ báo trùng) và dừng trước nến chứa tick đầu tiên sau khoảng đứt (các tick từ đó đánh giá trực tiếp). Alert đã nổ từ lúc đó thì thôi."""
        assert a.catch is not None
        since, until, _ = a.catch
        a.catch = None
        if a.state != "active" or (a.fired_at is not None and a.fired_at >= since):
            return None
        first, end = since // 60 * 60, until // 60 * 60
        prev: Optional[float] = None
        for b in self.bars(a.symbol, max(first, end - CATCHUP_MAX), end):
            if b["t"] == first:  # nến của lần đánh giá cuối: chỉ làm mốc giá
                prev = b["c"]
                continue
            if a.expires_at and b["t"] >= a.expires_at:
                break
            if touch(a.cond, a.level, prev, b):
                return self._fired(a, a.level, now, late_at=b["t"])
            prev = b["c"]
        return None

    def run_catchups(self) -> None:
        """Soát các alert đã phát hiện khoảng đứt mà EA đã nạp xong nến M1 (lắng CATCHUP_SETTLE giây) hoặc đã chờ quá CATCHUP_WAIT."""
        now = self.clock()
        fired: List[Fired] = []
        changed: List[Alert] = []
        with self._lock:
            for a in [a for lst in self._by_symbol.values() for a in lst if a.catch is not None]:
                started = a.catch[2]  # type: ignore[index]
                seen = self._bars_seen.get(a.symbol, 0.0)
                if not ((seen >= started and now - seen >= CATCHUP_SETTLE) or now - started >= CATCHUP_WAIT):
                    continue
                f = self._catch_up(a, now)
                if f is not None:
                    fired.append(f)
                    changed.append(a)
        self._emit(fired, changed)

    def flush(self) -> None:
        """Ghi mốc `checked_at` mới xuống DB (không ghi mỗi tick): khởi động lại thì biết đã đánh giá tới đâu."""
        with self._lock:
            rows = [(a.checked_at, a.id) for lst in self._by_symbol.values() for a in lst if a.checked_at is not None and a.checked_at != a.flushed]
            for lst in self._by_symbol.values():
                for a in lst:
                    a.flushed = a.checked_at
        if rows:
            self.checkpoint(rows)  # type: ignore[arg-type]

    # --- alert theo indicator ------------------------------------------------------------------------------------------------------------------------------

    def eval_indicators(self) -> None:
        """Xét mọi alert theo indicator (thread nền, vài giây một lần): tính indicator trên nến đã đóng trong DB (cộng nến đang chạy với giá tick mới nhất khi nổ theo giá),
        rồi so điều kiện như alert giá. "Đóng nến": mỗi nến vừa đóng một lần, theo thứ tự, nến chưa kịp xét lúc backend / EA tắt được xét bù (gắn "(trễ)")."""
        now = self.clock()
        with self._lock:
            targets = [a for lst in self._by_symbol.values() for a in lst if a.indicator]
        cache: Dict[Tuple[str, str, int], List[Dict[str, Any]]] = {}
        for a in targets:
            self._run(lambda a=a: self._eval_indicator(a, now, cache))  # type: ignore[misc]

    def _eval_indicator(self, a: Alert, now: float, cache: Dict[Tuple[str, str, int], List[Dict[str, Any]]]) -> None:
        spec = a.indicator
        assert spec is not None
        need = indicators.history_need(spec)
        rows = cache.get((a.symbol, a.tf, need))
        if rows is None:
            rows = cache[(a.symbol, a.tf, need)] = self.history(a.symbol, a.tf, need + 2)
        step = TF_SECONDS[a.tf]
        closed = [b for b in rows if b["t"] + step <= now]
        if len(closed) < 2:
            return  # chưa đủ nến (EA chưa nạp xong lịch sử)
        fired: Optional[Fired] = None
        if a.trigger == "once_per_bar_close":
            fired = self._eval_closed(a, closed, step, now)
        else:
            fired = self._eval_live(a, closed, step, now)
        if fired is not None:
            self._emit([fired], [a])

    @staticmethod
    def _ind_pair(a: Alert, line: List[float], other: Optional[List[float]], i: int) -> Tuple[float, float, Optional[float], Optional[float]]:
        """(đường, thứ được so) tại nến i và nến liền trước (None nếu thiếu số): thứ được so là `level` khi alert so với một mức cố định."""
        cur_b = a.level if other is None else other[i]
        prev_a, prev_b = line[i - 1], (a.level if other is None else other[i - 1])
        ok_prev = not (math.isnan(prev_a) or math.isnan(prev_b))
        return line[i], cur_b, (prev_a if ok_prev else None), (prev_b if ok_prev else None)

    def _ind_hit(self, a: Alert, line: List[float], other: Optional[List[float]], i: int) -> Optional[Tuple[float, float]]:
        v, lv, pv, plv = self._ind_pair(a, line, other, i)
        if math.isnan(v) or math.isnan(lv):
            return None
        return (v, lv) if hit(a.cond, lv, pv, v, plv) else None

    def _eval_closed(self, a: Alert, closed: List[Dict[str, Any]], step: int, now: float) -> Optional[Fired]:
        line, other = indicators.compute(a.indicator, closed)  # type: ignore[arg-type]
        with self._lock:
            if a.state != "active":
                return None
            last_t = closed[-1]["t"]
            if a.ind_bar is None:  # lần xét đầu: mốc là nến cuối đã đóng lúc alert được tạo / lần cuối được đánh giá (bắt đầu bù từ đó)
                since = now if a.ind_since is None else a.ind_since
                a.ind_bar = max((b["t"] for b in closed if b["t"] + step <= since), default=closed[0]["t"])
            found: Optional[Tuple[int, Tuple[float, float]]] = None
            for i in range(1, len(closed)):
                if closed[i]["t"] > a.ind_bar:
                    vals = self._ind_hit(a, line, other, i)
                    if vals is not None:
                        found = (i, vals)
                        break
            a.ind_bar = last_t
            if found is None:
                return None
            i, vals = found
            late = i != len(closed) - 1
            return self._fired(a, closed[i]["c"], now, late_at=closed[i]["t"] + step if late else None, values=vals)

    def _eval_live(self, a: Alert, closed: List[Dict[str, Any]], step: int, now: float) -> Optional[Fired]:
        last = self._last.get(a.symbol)
        if last is None:
            return None  # chưa có tick nào của symbol này
        price = last[1]
        key = (price, closed[-1]["t"])
        with self._lock:
            if a.ind_key == key:
                return None  # giá và nến đã đóng đều chưa đổi từ lần xét trước
        fb = self.live(a.symbol, a.tf)
        if fb is not None and fb["t"] > closed[-1]["t"]:
            forming = {**fb, "c": price}
        else:
            forming = {"t": closed[-1]["t"] + step, "o": price, "h": price, "l": price, "c": price, "v": 0.0}
        line, other = indicators.compute(a.indicator, closed + [forming])  # type: ignore[arg-type]
        i = len(line) - 1
        v, lv = self._ind_pair(a, line, other, i)[:2]
        with self._lock:
            if a.state != "active":
                return None
            prev, prev_b = a.ref, a.ind_ref_b
            a.ref, a.ind_ref_b, a.ind_key = (None if math.isnan(v) else v), (None if math.isnan(lv) else lv), key
            if math.isnan(v) or math.isnan(lv):
                return None
            if not hit(a.cond, lv, prev, v, prev_b if other is not None else None):
                return None
            if a.trigger == "once_per_bar":
                if a.last_bar == forming["t"]:
                    return None
                a.last_bar = forming["t"]
            elif a.trigger == "every_time" and now - a.last_fire < REFIRE_GAP:
                return None
            return self._fired(a, price, now, values=(v, lv))

    def housekeeping(self) -> None:
        """Việc định kỳ ở thread nền: hết hạn alert, báo bù, ghi mốc."""
        self.sweep()
        self.run_catchups()
        self.flush()

    def sweep(self) -> None:
        """Hết hạn cho alert quá `expires_at` (kể cả symbol đang không có tick, vd cuối tuần)."""
        now = self.clock()
        changed: List[Alert] = []
        with self._lock:
            for lst in list(self._by_symbol.values()):
                for a in list(lst):
                    if a.expires_at and now >= a.expires_at:
                        self._finish(a, "expired")
                        changed.append(a)
        self._emit([], changed)

    def _emit(self, fired: List[Fired], changed: List[Alert]) -> None:
        for a in changed:
            self.persist(a)
        for f in fired:
            self.fire(f)


# --- nối các mảnh -------------------------------------------------------------------------------------------------------------------------------------------

telegram = notify.Telegram(lambda: config.TG_BOT_TOKEN)


def _on_link(user_id: str, chat_id: int, who: str) -> None:
    channel_set(user_id, "telegram", {"chat_id": chat_id, "name": who})


def chat_of(user_id: str) -> Optional[int]:
    cfg = channel_get(user_id, "telegram")
    return cfg["chat_id"] if cfg and isinstance(cfg.get("chat_id"), int) else None


linker = notify.TelegramLinker(telegram, _on_link)
mt5push = notify.Mt5Push(state.ea_hub, mt5.registry.snapshot)
dispatcher = notify.Dispatcher(send_web=state.hub.send_user, telegram=telegram, chat_of=chat_of, mt5=mt5push, log_add=log_add, log_set=log_set)
engine = Engine(dispatcher.submit, db_persist_fire)
state.bar_close_hooks.append(engine.on_bar_close)
state.symbol_sources.append(engine.symbols)
engine.load(db_active())


housekeeper = notify.Ticker(CHECKPOINT_EVERY, engine.housekeeping, "alert-housekeeping")
indicator_ticker = notify.Ticker(IND_EVERY, engine.eval_indicators, "alert-indicators")


def start() -> None:
    """Bật thread nền (giao thông báo, việc định kỳ của engine, long-poll Telegram nếu có token). Gọi lúc backend khởi động; gọi lại không sao."""
    dispatcher.start()
    housekeeper.start()
    indicator_ticker.start()
    if telegram.configured:
        linker.start()


# --- API --------------------------------------------------------------------------------------------------------------------------------------------------

router = APIRouter(prefix="/alerts")
_last_test: Dict[Any, float] = {}


class AlertIn(BaseModel):
    symbol: str
    cond: str
    level: float
    trigger: str = "once"
    tf: str = "M1"
    expires_at: Optional[int] = None
    name: str = ""
    message: str = ""
    channels: Dict[str, bool] = {"web": True}
    drawing: Optional[Dict[str, Any]] = None  # bản sao hình vẽ (geometry.clean_spec): alert đi theo hình, `level` chỉ để hiển thị
    indicator: Optional[Dict[str, Any]] = None  # alert theo indicator (indicators.clean_spec): `level` là thứ được so khi vs = "level"


class AlertPatch(BaseModel):
    cond: Optional[str] = None
    level: Optional[float] = None
    trigger: Optional[str] = None
    tf: Optional[str] = None
    expires_at: Optional[int] = None
    clear_expiry: bool = False
    name: Optional[str] = None
    message: Optional[str] = None
    channels: Optional[Dict[str, bool]] = None
    drawing: Optional[Dict[str, Any]] = None  # hình vẽ vừa được kéo / sửa: thay bản sao toạ độ (alert phải đã gắn hình)
    indicator: Optional[Dict[str, Any]] = None  # đổi đường / thứ được so / tham số của alert theo indicator (cùng indicator)
    unlink: bool = False  # hình đã bị xoá nhưng giữ alert: bỏ liên kết, alert tiếp tục chạy với bản sao toạ độ cuối
    state: Optional[str] = None  # "active" | "paused" (bật lại alert đã nổ / hết hạn cũng qua đây)


def _bad(msg: str) -> HTTPException:
    return HTTPException(422, msg)


def _text(s: str, n: int, what: str) -> str:
    s = "".join(ch for ch in s if ch == "\n" or ch >= " ").strip()
    s = s.encode("utf-8", "replace").decode("utf-8")  # JSON từ trình duyệt có thể mang surrogate lẻ, ghi ra EA / Telegram sẽ lỗi
    if len(s) > n:
        raise _bad(f"{what} tối đa {n} ký tự")
    return s


def _check_symbol(s: str) -> str:
    s = s.strip()
    if not s or len(s) > 40:
        raise _bad("Symbol không hợp lệ")
    if state.symbols and s not in state.symbols:
        raise _bad(f"Symbol {s} không có trên MT5")
    return s


def _check_level(v: float) -> float:
    if not math.isfinite(v) or abs(v) >= 1e12:
        raise _bad("Giá không hợp lệ")
    return v


def check_channels(user: Dict[str, Any], ch: Dict[str, bool]) -> Dict[str, bool]:
    out = {k: bool(ch.get(k)) for k in CHANNEL_KEYS}
    if not any(out.values()):
        raise _bad("Chọn ít nhất một kênh thông báo")
    if out["telegram"] and chat_of(user["id"]) is None:
        raise _bad("Chưa kết nối Telegram (Settings → Alerts)")
    return out


def _check_expiry(v: Optional[int]) -> Optional[int]:
    if v is not None and v <= time.time():
        raise _bad("Hạn của alert phải ở tương lai")
    return v


def _check_drawing(raw: Dict[str, Any]) -> Dict[str, Any]:
    try:
        return geometry.clean_spec(raw)
    except ValueError as exc:
        raise _bad(str(exc))


def _check_indicator(raw: Dict[str, Any]) -> Dict[str, Any]:
    try:
        return indicators.clean_spec(raw)
    except ValueError as exc:
        raise _bad(str(exc))


def _check_enums(cond: str, trigger: str, tf: str, drawing: Optional[Dict[str, Any]] = None) -> None:
    if cond not in (CONDS[:5] if drawing is None else geometry.conds_for(drawing)):
        raise _bad("Điều kiện không hợp lệ")
    if trigger not in TRIGGERS:
        raise _bad("Kiểu nổ không hợp lệ")
    if tf not in TF_SECONDS or not TF_SECONDS[tf]:
        raise _bad("Khung thời gian không hợp lệ")


def _apply(a: Alert) -> Alert:
    """Ghi DB rồi đồng bộ engine (đặt lại mốc giá) và báo EA stream tick của symbol này. Tạo / sửa alert đặt lại mốc báo bù: không soát ngược về trước lúc này."""
    a.checked_at = int(time.time())
    a.catch = None
    db_save(a)
    engine.sync(a.id, a)
    state.push_subscribe()
    if a.indicator and a.state == "active":
        state.ensure_history(a.symbol, a.tf, indicators.history_need(a.indicator))  # indicator cần đủ lịch sử nến đã đóng để giá trị hội tụ
    elif a.drawing and a.state == "active":
        state.request_catchup(a.symbol, a.tf)  # đếm chỉ số nến cần đủ nến của TF này trong DB (chart không nhất thiết đang mở)
    return a


@router.get("")
def list_alerts(user: Dict[str, Any] = Depends(current_user)):
    engine.sweep()
    return [a.public() for a in db_list(user["id"])]


@router.post("", status_code=201)
def create_alert(body: AlertIn, user: Dict[str, Any] = Depends(current_user)):
    if body.drawing is not None and body.indicator is not None:
        raise _bad("Alert chỉ đi theo hình vẽ hoặc indicator, không cả hai")
    spec = _check_drawing(body.drawing) if body.drawing is not None else None
    ind = _check_indicator(body.indicator) if body.indicator is not None else None
    _check_enums(body.cond, body.trigger, body.tf, spec)
    if db_live_count(user["id"]) >= MAX_LIVE:
        raise HTTPException(409, f"Tối đa {MAX_LIVE} alert mỗi tài khoản")
    a = Alert(id=uuid.uuid4().hex, user_id=user["id"], symbol=_check_symbol(body.symbol), cond=body.cond, level=_check_level(body.level), trigger=body.trigger, tf=body.tf,
              expires_at=_check_expiry(body.expires_at), name=_text(body.name, MAX_NAME, "Tên"), message=_text(body.message, MAX_MESSAGE, "Nội dung"),
              channels=check_channels(user, body.channels), state="active", created_at=int(time.time()), drawing=spec, indicator=ind)
    return _apply(a).public()


@router.get("/log")
def get_log(limit: int = Query(100, ge=1, le=LOG_KEEP), user: Dict[str, Any] = Depends(current_user)):
    return log_list(user["id"], limit)


@router.get("/channels")
def get_channels(user: Dict[str, Any] = Depends(current_user)):
    tg = channel_get(user["id"], "telegram")
    return {
        "web": {},
        "telegram": {"configured": telegram.configured, "linked": tg is not None, "name": tg.get("name") if tg else None},
        "mt5": mt5push.status(),
    }


@router.post("/channels/telegram/link")
def link_telegram(user: Dict[str, Any] = Depends(current_user)):
    """Mã dùng một lần (10 phút) và link t.me tương ứng; người dùng mở link rồi bấm Start, thread long-poll sẽ gắn chat đó với tài khoản này."""
    if not telegram.configured:
        raise HTTPException(503, "Backend chưa có WICKLOOM_TG_BOT_TOKEN")
    bot = telegram.username()
    if not bot:
        raise HTTPException(502, "Không gọi được Telegram (kiểm tra token / mạng)")
    return {"url": f"https://t.me/{bot}?start={linker.new_code(user['id'])}", "expires_in": notify.LINK_TTL}


@router.delete("/channels/telegram")
def unlink_telegram(user: Dict[str, Any] = Depends(current_user)):
    channel_delete(user["id"], "telegram")
    return {"ok": True}


@router.post("/channels/{kind}/test")
def test_channel(kind: str, user: Dict[str, Any] = Depends(current_user)):
    if kind not in CHANNEL_KEYS:
        raise HTTPException(404)
    key = (user["id"], kind)
    if time.time() - _last_test.get(key, 0) < TEST_GAP:
        raise HTTPException(429, "Chờ vài giây rồi gửi thử lại", headers={"Retry-After": str(int(TEST_GAP))})
    _last_test[key] = time.time()
    if kind == "web":
        n = state.hub.send_user(user["id"], {"type": "alert_test", "text": "Tin thử từ Wickloom"})
        return {"ok": n > 0, "detail": "ok" if n else "không có tab Wickloom nào đang mở"}
    if kind == "telegram":
        chat = chat_of(user["id"])
        res = notify.NOT_CONFIGURED if not telegram.configured else "chưa kết nối Telegram" if chat is None else telegram.send(chat, "🔔 <b>Wickloom</b>\nTin thử: kênh Telegram hoạt động.")
    else:
        res = mt5push.send("Wickloom: tin thu - kenh MT5 hoat dong")
    return {"ok": res == "ok", "detail": res}


@router.patch("/{alert_id}")
def patch_alert(alert_id: str, body: AlertPatch, user: Dict[str, Any] = Depends(current_user)):
    a = db_get(user["id"], alert_id)
    if a is None:
        raise HTTPException(404)
    if body.state is not None and body.state not in ("active", "paused"):
        raise _bad("Trạng thái không hợp lệ")
    if body.cond is not None:
        a.cond = body.cond
    if body.level is not None:
        a.level = _check_level(body.level)
    if body.trigger is not None:
        a.trigger = body.trigger
    if body.tf is not None:
        a.tf = body.tf
    if body.drawing is not None:
        if a.drawing is None:
            raise _bad("Alert này không gắn với hình vẽ")
        spec = _check_drawing(body.drawing)
        if spec["type"] != a.drawing["type"]:
            raise _bad("Không đổi được loại hình vẽ của alert")
        a.drawing = spec
    if body.indicator is not None:
        if a.indicator is None:
            raise _bad("Alert này không theo indicator")
        spec = _check_indicator(body.indicator)
        if spec["id"] != a.indicator["id"]:
            raise _bad("Không đổi được indicator của alert")
        a.indicator = spec
    if body.unlink and a.drawing is not None:
        a.drawing = {**a.drawing, "id": None}
    _check_enums(a.cond, a.trigger, a.tf, a.drawing)
    if body.clear_expiry:
        a.expires_at = None
    elif body.expires_at is not None:
        a.expires_at = _check_expiry(body.expires_at)
    if body.name is not None:
        a.name = _text(body.name, MAX_NAME, "Tên")
    if body.message is not None:
        a.message = _text(body.message, MAX_MESSAGE, "Nội dung")
    if body.channels is not None:
        a.channels = check_channels(user, body.channels)
    if body.state is not None:
        if body.state == "active" and a.state in ("triggered", "expired"):
            if db_live_count(user["id"]) >= MAX_LIVE:
                raise HTTPException(409, f"Tối đa {MAX_LIVE} alert mỗi tài khoản")
            _check_expiry(a.expires_at)
        a.state = body.state
    return _apply(a).public()


@router.delete("/{alert_id}")
def delete_alert(alert_id: str, user: Dict[str, Any] = Depends(current_user)):
    if not db_delete(user["id"], alert_id):
        raise HTTPException(404)
    engine.sync(alert_id, None)
    state.push_subscribe()
    return {"ok": True}
