from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

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
                 on_close: Callable[[str, str, Dict[str, Any]], None],
                 on_unseeded: Optional[Callable[[str, str], None]] = None):
        self.load_last = load_last
        self.on_update = on_update
        self.on_close = on_close
        # Gọi khi bắt đầu gom 1 nến giữa chừng (backend vừa khởi động/reload, DB chưa có nến
        # này): nến mở từ tick đầu tiên thấy được nên sai giá mở/volume -> xin EA gửi nến
        # chuẩn của MT5 để `merge` lại.
        self.on_unseeded = on_unseeded
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
            first_run = bar is None
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
                if first_run and t - open_t > 1 and self.on_unseeded:
                    self.on_unseeded(symbol, tf)
                self.cur[key] = bar
            bar["h"] = max(bar["h"], price)
            bar["l"] = min(bar["l"], price)
            bar["c"] = price
            bar["v"] += 1  # tick volume
            self.on_update(symbol, tf, dict(bar))

    def merge(self, symbol: str, tf: str, bars: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Nến chuẩn từ MT5 (EA backfill) trùng nến đang gom: lấy open/volume của MT5 (tick đầu
        tiên backend thấy có thể muộn hơn open thật), giữ close mới nhất từ tick và mở rộng
        high/low. Trả nến sau khi gộp để phát lại cho chart; None nếu không có gì để gộp."""
        bar = self.cur.get((symbol, tf))
        if bar is None:
            return None
        ref = next((b for b in bars if b["t"] == bar["t"]), None)
        if ref is None:
            return None
        bar["o"] = ref["o"]
        bar["h"] = max(bar["h"], ref["h"])
        bar["l"] = min(bar["l"], ref["l"])
        bar["v"] = max(bar["v"], ref["v"])
        return dict(bar)
