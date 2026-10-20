from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional, Set, Tuple

from .config import TF_SECONDS


def bar_open(t_utc: int, tf: str, offset: int) -> int:
    """Mốc mở nến (UTC epoch) theo giờ broker = UTC + offset."""
    local = t_utc + offset
    if tf == "MN1":
        dt = datetime.fromtimestamp(local, tz=timezone.utc)
        start = int(dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp())
    elif tf == "W1":
        day = local - local % 86400
        dow = (datetime.fromtimestamp(day, tz=timezone.utc).weekday() + 1) % 7  # MT5: tuần mở Chủ nhật
        start = day - dow * 86400
    else:
        step = TF_SECONDS[tf]
        start = local - local % step
    return start - offset


class Aggregator:
    """Gom tick thành nến mọi TF; M1 luôn được gom."""

    def __init__(self, load_last: Callable[[str, str], Optional[Dict[str, Any]]],
                 on_update: Callable[[str, str, Dict[str, Any]], None],
                 on_close: Callable[[str, str, Dict[str, Any]], None]):
        self.load_last = load_last
        self.on_update = on_update
        self.on_close = on_close
        self.cur: Dict[Tuple[str, str], Dict[str, Any]] = {}
        self.tfs: Dict[str, Set[str]] = {}

    def watch(self, symbol: str, tf: str) -> None:
        self.tfs.setdefault(symbol, {"M1"}).add(tf)

    def tick(self, symbol: str, t_msc: int, price: float, vol: float, offset: int) -> None:
        t = t_msc // 1000
        for tf in self.tfs.setdefault(symbol, {"M1"}):
            key = (symbol, tf)
            open_t = bar_open(t, tf, offset)
            bar = self.cur.get(key)
            if bar is None:
                prev = self.load_last(symbol, tf)
                if prev and prev["t"] == open_t:
                    bar = dict(prev)
                    self.cur[key] = bar
            if bar is not None and bar["t"] > open_t:
                continue  # tick cũ
            if bar is not None and bar["t"] < open_t:
                self.on_close(symbol, tf, dict(bar))
                bar = None
            if bar is None:
                bar = {"t": open_t, "o": price, "h": price, "l": price, "c": price, "v": 0.0}
                self.cur[key] = bar
            bar["h"] = max(bar["h"], price)
            bar["l"] = min(bar["l"], price)
            bar["c"] = price
            bar["v"] += 1  # tick volume
            self.on_update(symbol, tf, dict(bar))
