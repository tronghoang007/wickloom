"""Lịch kinh tế: EA TVBridge (>= 2.15) đọc lịch có sẵn của MT5 (CalendarValueHistory) rồi đẩy lên bằng thông điệp `calendar`; backend lưu SQLite (bảng riêng
`calendar_events` trong meta.sqlite, KHÔNG nằm trong TABLES vì CRUD generic của bảng đó mở cho ai cũng ghi được) và web đọc qua `GET /calendar`. Nhờ vậy lịch không phụ thuộc
mạng ngoài / DNS (widget TradingView bị nhà mạng chặn từng lúc) và vẫn xem được bản cache khi EA offline. Mỗi lần EA gửi là CẢ cửa sổ [from, to]: sự kiện trong cửa sổ mà lần này
không còn (bị huỷ / dời) thì xoá; sự kiện cũ hơn cửa sổ giữ lại tới RETENTION_DAYS để xem lại kết quả đã công bố. (docs/calendar-plan.md)"""
import math
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query

from . import mt5, state

RETENTION_DAYS = 45
MAX_EVENTS = 3000  # mỗi lần EA gửi; nhiều hơn thì cắt
MAX_RANGE_DAYS = 62  # một lần đọc
MIN_EA = (2, 15)
META_KEY = "calendar"

state.meta.db.execute(
    "CREATE TABLE IF NOT EXISTS calendar_events ("
    "id INTEGER PRIMARY KEY, time INTEGER NOT NULL, event_id INTEGER NOT NULL DEFAULT 0, country TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT '', "
    "name TEXT NOT NULL DEFAULT '', importance INTEGER NOT NULL DEFAULT 0, unit INTEGER NOT NULL DEFAULT 0, multiplier INTEGER NOT NULL DEFAULT 0, digits INTEGER NOT NULL DEFAULT 0, "
    "time_mode INTEGER NOT NULL DEFAULT 0, impact INTEGER NOT NULL DEFAULT 0, actual REAL, forecast REAL, previous REAL, revised REAL)"
)
state.meta.db.execute("CREATE INDEX IF NOT EXISTS calendar_events_time ON calendar_events(time)")
state.meta.db.commit()

COLS = ("id", "time", "event_id", "country", "currency", "name", "importance", "unit", "multiplier", "digits", "time_mode", "impact", "actual", "forecast", "previous", "revised")


def _int(v: Any, lo: int = 0, hi: int = 2**62) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return lo
    return max(lo, min(hi, int(v)))


def _num(v: Any) -> Optional[float]:
    return float(v) if not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v) else None


def _str(v: Any, n: int) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


def clean_event(d: Any) -> Optional[Dict[str, Any]]:
    """Một sự kiện từ EA: ép kiểu, chỉ giữ trường đã biết. Không có id hoặc thời gian thì bỏ."""
    if not isinstance(d, dict):
        return None
    eid, t = _int(d.get("id")), _int(d.get("time"))
    if not eid or not t:
        return None
    return {
        "id": eid, "time": t, "event_id": _int(d.get("event_id")), "country": _str(d.get("country"), 4).upper(), "currency": _str(d.get("currency"), 4).upper(),
        "name": _str(d.get("name"), 160), "importance": _int(d.get("importance"), 0, 3), "unit": _int(d.get("unit"), 0, 99), "multiplier": _int(d.get("multiplier"), 0, 9),
        "digits": _int(d.get("digits"), 0, 8), "time_mode": _int(d.get("time_mode"), 0, 9), "impact": _int(d.get("impact"), 0, 2),
        "actual": _num(d.get("actual")), "forecast": _num(d.get("forecast")), "previous": _num(d.get("previous")), "revised": _num(d.get("revised")),
    }


def ingest(msg: Dict[str, Any], now: Optional[float] = None) -> int:
    """Thông điệp `calendar` của EA: {from, to, events[]}. Trả số sự kiện đã lưu. Danh sách rỗng KHÔNG xoá gì (lịch MT5 chưa đồng bộ xong cũng trả rỗng)."""
    now = time.time() if now is None else now
    raw = msg.get("events")
    evs = [e for e in (clean_event(x) for x in (raw[:MAX_EVENTS] if isinstance(raw, list) else [])) if e]
    if not evs:
        return 0
    lo = _int(msg.get("from"), 0) or min(e["time"] for e in evs)
    hi = _int(msg.get("to"), 0) or max(e["time"] for e in evs)
    keep = {e["id"] for e in evs}
    with state.meta.tx() as db:
        for (i,) in db.execute("SELECT id FROM calendar_events WHERE time BETWEEN ? AND ?", (lo, hi)).fetchall():
            if i not in keep:
                db.execute("DELETE FROM calendar_events WHERE id=?", (i,))
        db.executemany(
            f"INSERT INTO calendar_events ({','.join(COLS)}) VALUES ({','.join('?' * len(COLS))}) ON CONFLICT(id) DO UPDATE SET "
            + ",".join(f"{c}=excluded.{c}" for c in COLS[1:]),
            [tuple(e[c] for c in COLS) for e in evs],
        )
        db.execute("DELETE FROM calendar_events WHERE time < ?", (int(now - RETENTION_DAYS * 86400),))
    state.meta.put("settings", META_KEY, "", {"updated_at": now, "from": lo, "to": hi, "count": len(evs)})
    return len(evs)


def query(lo: int, hi: int, min_importance: int = 0, currencies: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    sql = f"SELECT {','.join(COLS)} FROM calendar_events WHERE time BETWEEN ? AND ? AND importance >= ?"
    args: List[Any] = [lo, hi, min_importance]
    if currencies:
        sql += f" AND currency IN ({','.join('?' * len(currencies))})"
        args += currencies
    sql += " ORDER BY time, importance DESC, id"
    with state.meta._lock:
        rows = state.meta.db.execute(sql, args).fetchall()
    return [dict(zip(COLS, r)) for r in rows]


def _ea_status() -> Dict[str, Any]:
    """EA đang kết nối có gửi được lịch không (>= 2.15): để web nói đúng lý do khi chưa có dữ liệu."""
    acc = next((a for a in mt5.registry.snapshot() if a.get("online")), None)
    ver = acc.get("ea_version") if acc else None
    parsed = tuple(int(x) for x in str(ver).split(".") if x.isdigit()) if ver else ()
    return {"online": acc is not None, "version": ver, "supports": bool(parsed) and parsed >= MIN_EA}


router = APIRouter()


@router.get("/calendar")
def get_calendar(
    from_: Optional[int] = Query(None, alias="from"),
    to: Optional[int] = None,
    min_importance: int = Query(0, ge=0, le=3),
    currencies: str = "",
):
    """Sự kiện kinh tế trong [from, to] (epoch giây UTC; mặc định từ hôm qua tới 7 ngày nữa), tối đa MAX_RANGE_DAYS. `currencies` = "USD,EUR" (rỗng = tất cả).
    `updated_at` = lần cuối EA gửi (None = chưa từng): web dùng cùng `ea` để giải thích khi trống."""
    now = int(time.time())
    lo = from_ if from_ is not None else now - 86400
    hi = min(to if to is not None else lo + 8 * 86400, lo + MAX_RANGE_DAYS * 86400)
    cur = [c for c in (x.strip().upper() for x in currencies.split(",")) if c]
    row = state.meta.get("settings", META_KEY)
    return {"events": query(lo, hi, min_importance, cur or None), "updated_at": row["data"].get("updated_at") if row else None, "ea": _ea_status(), "now": now}
