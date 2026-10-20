import asyncio
import json
import shutil
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from .aggregator import Aggregator
from .config import BARS_DIR
from .store import BarStore, MetaStore
from .ws import Hub

bars = BarStore()
meta = MetaStore()
hub = Hub()
symbols: Dict[str, Dict[str, Any]] = {}
broker_offset = {"value": 0}
pending_backfill: List[Dict[str, Any]] = []

# Nạp danh sách symbols đã lưu trong SQLite khi khởi động BE
for _row in meta.list("symbols"):
    symbols[_row["id"]] = _row["data"]


def _on_update(symbol: str, tf: str, bar: Dict[str, Any]) -> None:
    hub.publish(symbol, tf, {"type": "bar_update", "symbol": symbol, "tf": tf, "bar": bar})


def _on_close(symbol: str, tf: str, bar: Dict[str, Any]) -> None:
    bars.upsert(symbol, tf, [bar])
    hub.publish(symbol, tf, {"type": "bar_close", "symbol": symbol, "tf": tf, "bar": bar})


aggregator = Aggregator(bars.last, _on_update, _on_close)


class EaHub:
    """Các TCP connection của EA (TVBridge) đang kết nối tới backend - đẩy lệnh ngay,
    không chờ EA poll."""

    def __init__(self) -> None:
        self.writers: set = set()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def add(self, writer: Any) -> None:
        self.writers.add(writer)

    def remove(self, writer: Any) -> None:
        self.writers.discard(writer)

    def push(self, msg: Dict[str, Any]) -> None:
        """Gửi tới mọi EA đang kết nối. An toàn gọi từ cả route sync (worker thread)
        và async (event loop)."""
        for w in list(self.writers):
            if self._loop is not None and self._loop.is_running():
                asyncio.run_coroutine_threadsafe(self._send(w, msg), self._loop)
            else:
                asyncio.ensure_future(self._send(w, msg))

    async def _send(self, writer: Any, msg: Dict[str, Any]) -> None:
        try:
            writer.write((json.dumps(msg, separators=(",", ":")) + "\n").encode("utf-8"))
            await writer.drain()
        except Exception:
            self.writers.discard(writer)


ea_hub = EaHub()


def request_backfill(symbol: str, tf: str, count: int = 500, pos: int = 0, before: int = 0) -> None:
    """Xin EA nạp thêm bar. `before` (epoch UTC giây) ưu tiên hơn `pos` nếu > 0 - dùng để
    nhảy thẳng tới 1 mốc thời gian (đổi timeframe/replay); nếu không, `pos` theo kiểu
    index (số bar tính từ nến mới nhất) dùng cho scroll-back tuần tự."""
    cmd: Dict[str, Any] = {"type": "backfill", "symbol": symbol, "tf": tf, "count": count}
    if before:
        cmd["before"] = before
    else:
        cmd["pos"] = pos
    if ea_hub.writers:
        ea_hub.push(cmd)
        return
    key = (symbol, tf, pos, before)
    for c in pending_backfill:
        if (c["symbol"], c["tf"], c.get("pos", 0), c.get("before", 0)) == key:
            return
    pending_backfill.append(cmd)


def check_broker_switch(name: str) -> bool:
    """So broker hiện tại (lưu trong bảng settings) với `name` EA vừa báo qua hello.
    Trả True nếu đây là một broker KHÁC lần trước (cần resync); False nếu giống hoặc
    đây là lần đầu backend biết broker (không có gì để resync)."""
    if not name:
        return False
    row = meta.get("settings", "broker")
    prev = row["data"].get("name") if row else None
    if prev == name:
        return False
    meta.put("settings", "broker", "", {"name": name})
    return prev is not None


def resync_after_broker_switch() -> Optional[Path]:
    """Dọn state cũ khi đổi broker: archive (move, không xoá) toàn bộ bar cache, xoá
    symbols đã biết, clear bar đang gom dở. need_symbols/backfill tự chạy lại sau đó
    qua các cơ chế đã có sẵn (EA luôn gửi symbols sau hello; /ws subscribe tự backfill
    khi thiếu/stale)."""
    archive_path: Optional[Path] = None
    if BARS_DIR.exists() and any(BARS_DIR.iterdir()):
        archive_path = BARS_DIR.parent / f"bars_archive_{int(time.time())}"
        shutil.move(str(BARS_DIR), str(archive_path))
    meta.clear("symbols")
    symbols.clear()
    aggregator.cur.clear()
    return archive_path
