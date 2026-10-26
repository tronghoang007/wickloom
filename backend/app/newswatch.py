"""Báo trước tin kinh tế (docs/alerts-plan.md Phase 3, mục 1). Lịch lấy từ `economic.py` (EA đẩy lên, cache trong meta.sqlite) nên nhắc vẫn chạy khi tắt tab; chỉ cần backend đang chạy.
Mỗi user bật quy tắc `news` (rules.py): báo trước các mốc `leads` phút, chỉ sự kiện từ mức quan trọng `min_importance` và đúng đồng tiền đã chọn. Các sự kiện cùng giờ gộp thành MỘT tin
(NFP kéo theo vài chỉ số cùng lúc không được làm ngập Telegram / MT5). Mốc đã báo ghi vào `news_sent` để khởi động lại backend không báo lặp, và dời giờ sự kiện thì báo lại theo giờ mới."""
import math
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import alerts, economic, notify, rules, state

TICK = 10.0  # giây giữa hai lần xét
KEEP = 3 * 86400  # giữ dấu "đã báo" bấy lâu sau giờ sự kiện
IMPORTANCE = {1: "Low", 2: "Medium", 3: "High"}
MULT = ("", "K", "M", "B", "T")  # như web (calendarFormat.ts)

with state.meta.tx() as _db:
    _db.execute(
        "CREATE TABLE IF NOT EXISTS news_sent (user_id TEXT NOT NULL, event_id INTEGER NOT NULL, event_time INTEGER NOT NULL, lead INTEGER NOT NULL, sent_at INTEGER NOT NULL, "
        "PRIMARY KEY (user_id, event_id, event_time, lead))"
    )


def fmt_value(v: Optional[float], e: Dict[str, Any]) -> str:
    """"3.8%", "200K"; không có số -> "-" (cùng quy tắc `fmtEventValue` của web)."""
    if v is None or not math.isfinite(v):
        return "-"
    return f"{v:.{max(0, min(8, e['digits']))}f}{MULT[e['multiplier']] if 0 <= e['multiplier'] < len(MULT) else ''}{'%' if e['unit'] == 1 else ''}"


def event_line(e: Dict[str, Any]) -> str:
    """"USD Non-Farm Payrolls (High) 12:30 UTC · forecast 180K · prev 175K" (forecast / prev chỉ khi có)."""
    s = f"{e['currency'] or e['country']} {e['name']} ({IMPORTANCE.get(e['importance'], '-')}) {time.strftime('%H:%M', time.gmtime(e['time']))} UTC"
    if e["forecast"] is not None:
        s += f" · forecast {fmt_value(e['forecast'], e)}"
    if e["previous"] is not None:
        s += f" · prev {fmt_value(e['previous'], e)}"
    return s


class NewsWatcher:
    def __init__(self, submit: Callable[[notify.Fired], None], users: Callable[[], List[Tuple[str, Dict[str, Any]]]], events: Callable[..., List[Dict[str, Any]]],
                 clock: Callable[[], float] = time.time):
        self.submit = submit
        self.users = users
        self.events = events
        self.clock = clock

    def _sent(self, user_id: str, e: Dict[str, Any], lead: int) -> bool:
        with state.meta._lock:
            return state.meta.db.execute("SELECT 1 FROM news_sent WHERE user_id=? AND event_id=? AND event_time=? AND lead=?", (user_id, e["id"], e["time"], lead)).fetchone() is not None

    def _mark(self, user_id: str, e: Dict[str, Any], leads: List[int], now: float) -> None:
        with state.meta.tx() as db:
            db.executemany("INSERT OR IGNORE INTO news_sent (user_id, event_id, event_time, lead, sent_at) VALUES (?,?,?,?,?)", [(user_id, e["id"], e["time"], m, int(now)) for m in leads])

    def tick(self) -> int:
        """Gửi các nhắc đến hạn; trả số tin đã giao cho Dispatcher."""
        now = self.clock()
        sent = 0
        for user_id, cfg in self.users():
            leads: List[int] = cfg["leads"]
            evs = self.events(int(now), int(now) + max(leads) * 60 + 1, cfg["min_importance"], cfg["currencies"] or None)
            groups: Dict[int, List[Dict[str, Any]]] = {}
            for e in evs:
                remain = e["time"] - now
                if e["time_mode"] != 0 or remain <= 0:  # cả ngày / dự kiến / không giờ: không có giờ để báo trước; sự kiện đã tới giờ thì thôi
                    continue
                due = [m for m in leads if remain <= m * 60]
                if not due or all(self._sent(user_id, e, m) for m in due):
                    continue
                self._mark(user_id, e, due, now)  # mốc lớn hơn không báo bù sau khi mốc nhỏ đã tới hạn (khởi động lại sát giờ chỉ báo một lần)
                groups.setdefault(e["time"], []).append(e)
            for t, group in sorted(groups.items()):
                mins = max(1, math.ceil((t - now) / 60))
                self.submit(notify.notice(user_id, "news", f"Economic news in {mins} min", "\n".join(event_line(e) for e in group), cfg["channels"], now))
                sent += 1
        return sent

    def cleanup(self) -> None:
        with state.meta.tx() as db:
            db.execute("DELETE FROM news_sent WHERE event_time < ?", (int(self.clock() - KEEP),))


watcher = NewsWatcher(alerts.dispatcher.submit, lambda: rules.enabled("news"), economic.query)
_ticker = notify.Ticker(TICK, watcher.tick, "news-watch")


def start() -> None:
    watcher.cleanup()
    _ticker.start()
