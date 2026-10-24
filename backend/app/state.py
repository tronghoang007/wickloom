import asyncio
import json
import shutil
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import tickdelta
from .aggregator import Aggregator
from .config import BARS_DB, BARS_DIR, TF_SECONDS, is_stale
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


_seeding: Dict[tuple, float] = {}


def _on_unseeded(symbol: str, tf: str) -> None:
    """Nến đang gom bắt đầu giữa chừng -> xin EA 3 nến mới nhất của MT5 (gồm nến đang chạy)
    cùng phần còn thiếu nếu cache cũ; chặn gửi lặp trong 5s."""
    now = time.time()
    if now - _seeding.get((symbol, tf), 0) < 5:
        return
    _seeding[(symbol, tf)] = now
    request_backfill(symbol, tf, 3)
    request_catchup(symbol, tf)


_gap_seeding: Dict[tuple, float] = {}


def _on_gap(symbol: str, gap_seconds: int) -> None:
    """Luồng tick vừa đứt `gap_seconds` giây rồi nối lại -> xin EA nến chuẩn cho đúng khoảng đó ở mọi TF đang xem (cache ghi đè bằng nến MT5, nến đang gom `merge` lại).
    Số nến = số nến khoảng đứt trải qua + 3, tối đa 500; chặn gửi lặp cùng (symbol, tf) trong 30s."""
    now = time.time()
    for tf in sorted(aggregator.tfs.get(symbol, {"M1"})):
        if now - _gap_seeding.get((symbol, tf), 0) < 30:
            continue
        _gap_seeding[(symbol, tf)] = now
        request_backfill(symbol, tf, min(500, gap_seconds // TF_SECONDS[tf] + 3))
    tick_live.reset(symbol)  # delta theo tick mất tick trong khoảng đứt: tính lại từ lịch sử tick của EA


aggregator = Aggregator(bars.last, _on_update, _on_close, _on_unseeded, _on_gap)


class EaHub:
    """Các TCP connection của EA (TVBridge) đang kết nối tới backend - đẩy lệnh ngay,
    không chờ EA poll."""

    def __init__(self) -> None:
        self.writers: set = set()
        self.idents: Dict[Any, str] = {}  # writer -> server MT5 của EA đó
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def add(self, writer: Any, ident: str = "") -> None:
        self.writers.add(writer)
        self.idents[writer] = ident

    def remove(self, writer: Any) -> None:
        self.writers.discard(writer)
        self.idents.pop(writer, None)

    def active_ident(self) -> Optional[str]:
        """Server của EA đang kết nối (None nếu chưa có EA nào / EA cũ không báo server)."""
        return next((i for w, i in self.idents.items() if w in self.writers and i), None)

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


# MT5 mặc định "Max bars in chart" = 100000 - xin nhiều hơn cũng không có thêm.
MAX_CATCHUP_BARS = 100000


def request_catchup(symbol: str, tf: str) -> None:
    """Cache rỗng hoặc bar cuối đã cũ -> xin EA đủ số bar (tính từ nến mới nhất) để nối
    liền với bar cuối đang có. Chỉ xin 500 bar như trước sẽ để lại 1 lỗ ở giữa khi
    EA/backend tắt lâu hơn 500 nến (vd M1 qua 1 ngày)."""
    last = bars.last(symbol, tf)
    last_t = last["t"] if last else None
    if not is_stale(last_t, tf):
        # Chưa cũ thì không cần nối thêm, nhưng 3 nến cuối có thể đóng dở (EA / backend tắt giữa nến, nến cuối chưa bị coi là cũ): lấy lại của MT5, rẻ
        request_backfill(symbol, tf, 3)
        return
    count = 500
    if last_t is not None:
        gap = int((time.time() - last_t) / TF_SECONDS[tf]) + 10
        count = max(count, min(MAX_CATCHUP_BARS, gap))
    request_backfill(symbol, tf, count)


# Delta theo tick realtime (CVD / Big Trades): xin EA 2 phút tick gần nhất làm gốc cho phút đang chạy
tick_live = tickdelta.Live(lambda symbol: request_backfill(symbol, tickdelta.TICK_DELTA_TF, 2, before=int(time.time())))


def check_broker_switch(company: str, server: str = "") -> bool:
    """So nguồn dữ liệu (server MT5, vd "Exness-MT5Trial17") EA vừa báo qua hello với lần
    trước (bảng settings). Trả True nếu là server KHÁC (cần resync); False nếu giống,
    lần đầu, hoặc EA cũ không báo gì. Cùng server khác login = cùng dữ liệu -> không resync.
    EA < v2.09 chỉ báo tên công ty: nếu bản lưu cũ chỉ có tên công ty trùng thì nhận server
    mới luôn, không resync (tránh xoá cache ngay lần nâng cấp EA)."""
    ident = server or company
    if not ident:
        return False
    row = meta.get("settings", "broker")
    data = row["data"] if row else {}
    if not server and data.get("name") == company:
        return False  # EA cũ không báo server: cùng công ty thì không đoán là đổi
    prev = data.get("server") or data.get("name")
    if prev == ident:
        return False
    meta.put("settings", "broker", "", {"name": company, "server": server})
    if server and not data.get("server") and data.get("name") == company:
        return False
    return prev is not None


def resync_after_broker_switch() -> Optional[Path]:
    """Dọn state cũ khi đổi broker/server: archive (không xoá) toàn bộ bar cache, xoá
    symbols đã biết, clear bar đang gom dở. need_symbols/backfill tự chạy lại sau đó
    qua các cơ chế đã có sẵn (EA luôn gửi symbols sau hello; /ws subscribe tự backfill
    khi thiếu/stale). Chart đang mở nhận "reset" để bỏ bar cũ trong bộ nhớ."""
    archive_path = bars.archive(BARS_DB.parent / f"bars_archive_{int(time.time())}.sqlite")
    if BARS_DIR.exists() and any(BARS_DIR.iterdir()):  # cache parquet cũ còn sót
        shutil.move(str(BARS_DIR), str(BARS_DIR.parent / f"bars_parquet_archive_{int(time.time())}"))
    meta.clear("symbols")
    symbols.clear()
    aggregator.cur.clear()
    aggregator.last_tick.clear()
    tick_live.clear()
    pending_backfill.clear()  # lệnh neo theo dữ liệu của server cũ
    hub.broadcast({"type": "reset", "reason": "broker"})
    return archive_path
