"""Delta theo tick cho CVD "Data aggregation = 1 tick" và Big Trades của web.

EA gửi lịch sử tick (`ticks_hist`, giá + trọng số từng tick) khi web xin backfill tf "TD"; ở đây mỗi tick được phân loại lên / xuống rồi gom thành
MỖI PHÚT một "nến delta" lưu trong bảng `bars` với tf "TD" (không lưu tick thô):
  o = 0, c = delta tích luỹ cuối phút, h / l = đỉnh / đáy của delta tích luỹ qua từng tick trong phút (gồm cả mốc 0 đầu phút), v = tổng trọng số.
Web nối các phút lại thành nến CVD của chart (đầu nến = delta tích luỹ trước đó, h / l = đầu + h / l của từng phút) nên high / low chính xác tới từng tick.

Cùng lượt phân loại đó còn gom histogram giá theo phút (`hist`: (phút, giá) -> [volume lên, volume xuống]) lưu ở bảng `tickvp` cho Session / Visible Range
Volume Profile "1 tick" và Big Trades: mỗi tick rơi đúng vào row chứa giá của nó thay vì chia volume nến theo vùng giá. Một phút có dòng `bars` "TD" thì cũng có dòng `tickvp`.

Chiều của tick như script TV (ta.requestVolumeDelta với khung 1 tick): giá cao hơn tick trước = lên, thấp hơn = xuống, bằng nhau thì giữ chiều trước.

REALTIME: tick trực tiếp EA đẩy tới (`ticks`) cũng được phân loại ngay ở đây (`Live`), phút đang chạy được ghi lại và đẩy xuống web (`tick_delta`) sau mỗi lô tick,
nên CVD / Big Trades không phải chờ EA tính lại. Lúc bắt đầu (hoặc sau khi luồng tick đứt) phút đang chạy chưa biết hết tick nên xin EA lịch sử tick vài phút gần nhất để làm gốc.
"""
import itertools
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from .models import TicksHistIn

TICK_DELTA_TF = "TD"

# symbol -> (giá, chiều) của tick cuối thông điệp trước, dùng cho thông điệp `cont` kế tiếp cùng một yêu cầu
_carry: Dict[str, Tuple[float, int]] = {}

Cells = Dict[float, List[float]]  # giá -> [volume lên, volume xuống] của một phút
Row = Dict[str, Any]  # dòng bars tf "TD"


class Acc:
    """Gom tick (tăng dần theo thời gian) thành nến delta từng phút; phút đã xong nằm ở `closed`, phút đang mở là `row()` / `cells`."""

    def __init__(self, prev_price: float = 0.0, prev_dir: int = 1) -> None:
        self.prev_price, self.prev_dir = prev_price, prev_dir
        self.closed: List[Tuple[Row, Cells]] = []
        self.minute: Optional[int] = None
        self.cum = self.hi = self.lo = self.vol = 0.0
        self.cells: Cells = {}

    def row(self) -> Optional[Row]:
        return None if self.minute is None else {"t": self.minute, "o": 0.0, "h": self.hi, "l": self.lo, "c": self.cum, "v": self.vol}

    def close(self) -> None:
        """Đóng phút đang mở (chuyển sang `closed`)."""
        if self.minute is not None:
            self.closed.append((self.row(), self.cells))  # type: ignore[arg-type]
        self.minute, self.cum, self.hi, self.lo, self.vol, self.cells = None, 0.0, 0.0, 0.0, 0.0, {}

    def add(self, t_msc: int, p: float, w: float) -> None:
        """Một tick giá `p` > 0, trọng số `w` > 0, lúc `t_msc` (UTC ms) không sớm hơn tick trước."""
        d = (1 if p > self.prev_price else -1 if p < self.prev_price else self.prev_dir) if self.prev_price > 0 else self.prev_dir
        self.prev_price, self.prev_dir = p, d
        m = t_msc // 60000 * 60
        if m != self.minute:
            self.close()
            self.minute = m
        self.cells.setdefault(p, [0.0, 0.0])[0 if d > 0 else 1] += w
        self.cum += d * w
        self.hi = max(self.hi, self.cum)
        self.lo = min(self.lo, self.cum)
        self.vol += w


def _run(acc: Acc, t_msc: List[int], price: List[float], weight: Optional[List[float]]) -> None:
    for i, p in enumerate(price):
        if p <= 0:
            continue
        acc.add(t_msc[i], p, weight[i] if weight is not None and i < len(weight) and weight[i] > 0 else 1.0)


def classify(t_msc: List[int], price: List[float], weight: Optional[List[float]], prev_price: float, prev_dir: int,
             hist: Optional[Dict[Tuple[int, float], List[float]]] = None) -> Tuple[List[Dict[str, Any]], float, int]:
    """Gom các tick (tăng dần theo t_msc, UTC) thành nến delta từng phút. Trả (các dòng bars, giá cuối, chiều cuối).
    `prev_price` <= 0 = không biết tick liền trước: tick đầu lấy `prev_dir`. `hist` (nếu có) cộng thêm trọng số từng tick vào ô (phút, giá)."""
    acc = Acc(prev_price, prev_dir)
    _run(acc, t_msc, price, weight)
    acc.close()
    if hist is not None:
        for row, cells in acc.closed:
            for p, (up, dn) in cells.items():
                h = hist.setdefault((row["t"], p), [0.0, 0.0])
                h[0] += up
                h[1] += dn
    return [row for row, _ in acc.closed], acc.prev_price, acc.prev_dir


# symbol -> (Acc của phút cuối thông điệp `done`, UTC ms của tick cuối, số thứ tự lúc nhận): gốc cho `Live.seed`
_tail: Dict[str, Tuple[Acc, int, int]] = {}
_seq = itertools.count(1)  # thứ tự nhận lịch sử tick và thứ tự xin EA: chỉ lịch sử nhận SAU lần xin mới là "tới giờ hiện tại"


def ingest(body: TicksHistIn, hist: Optional[Dict[Tuple[int, float], List[float]]] = None) -> List[Dict[str, Any]]:
    """Phân loại một thông điệp `ticks_hist` -> các dòng bars tf "TD" (người gọi ghi vào kho) và, nếu có `hist`, histogram giá theo phút.
    EA cắt thông điệp ở ranh giới phút nên mỗi phút nằm trọn trong một thông điệp."""
    off = body.broker_utc_offset * 1000
    t = [x - off for x in body.t]
    cont = _carry.get(body.symbol) if body.cont else None
    prev_price, prev_dir = cont if cont else (body.pb, -1 if body.pd < 0 else 1)
    acc = Acc(prev_price, prev_dir)
    _run(acc, t, body.p, body.w)
    _carry[body.symbol] = (acc.prev_price, acc.prev_dir)
    last = acc.row()
    if body.done and last is not None:
        _tail[body.symbol] = (_copy(acc), max(t), next(_seq))
    acc.close()
    if hist is not None:
        for row, cells in acc.closed:
            for p, (up, dn) in cells.items():
                h = hist.setdefault((row["t"], p), [0.0, 0.0])
                h[0] += up
                h[1] += dn
    return [row for row, _ in acc.closed]


def _copy(acc: Acc) -> Acc:
    out = Acc(acc.prev_price, acc.prev_dir)
    out.minute, out.cum, out.hi, out.lo, out.vol = acc.minute, acc.cum, acc.hi, acc.lo, acc.vol
    out.cells = {p: list(c) for p, c in acc.cells.items()}
    return out


# --- realtime ----------------------------------------------------------------------------------------------------------------------------------------------

LiveTick = Tuple[int, float, float, bool]  # (UTC ms, giá, trọng số, bỏ nếu giá không đổi)

SEED_WAIT = 6.0  # giây chờ EA trả lịch sử tick làm gốc; hết hạn thì tính từ tick trực tiếp (EA không có tick nào trước đó)
SEED_RETRY = 2.0  # giây giữa hai lần xin EA (EA thường trả trong dưới 1 giây, xin lại phòng mất yêu cầu)
PENDING_MAX = 50_000  # tick giữ lại trong lúc chờ gốc


class Update:
    """Kết quả một lô tick: các phút vừa xong (đã chốt), phút đang chạy (`row`, `cells`)."""

    def __init__(self, closed: List[Tuple[Row, Cells]], row: Optional[Row], cells: Cells) -> None:
        self.closed, self.row, self.cells = closed, row, cells


class _Sym:
    def __init__(self, now: float) -> None:
        self.acc: Optional[Acc] = None  # None = chưa có gốc
        self.last_ms = 0  # tick trực tiếp mới nhất đã áp
        self.floor = -1  # tick của gốc EA: tick trực tiếp tới muộn trùng khoảng này (<= floor) là bản sao, bỏ
        self.pending: List[LiveTick] = []
        self.since = now
        self.asked = 0.0  # giờ (đồng hồ) lần xin EA gần nhất
        self.ask_seq = 0  # thứ tự lần xin đó (xem `_seq`)


class Live:
    """Delta theo tick realtime của từng symbol. `ask(symbol)` xin EA lịch sử tick vài phút gần nhất (qua backfill tf "TD"); EA trả `ticks_hist` thì
    `ingest` giữ phút cuối làm gốc và người gọi gọi `seed`. Trong lúc chờ, tick trực tiếp được giữ trong `pending`."""

    def __init__(self, ask: Callable[[str], None], clock: Callable[[], float] = time.time) -> None:
        self.ask, self.clock = ask, clock
        self.sym: Dict[str, _Sym] = {}

    def reset(self, symbol: str) -> None:
        """Luồng tick đứt / đổi nguồn: bỏ trạng thái, lô tick kế tiếp xin lại gốc từ EA."""
        self.sym.pop(symbol, None)
        _tail.pop(symbol, None)

    def clear(self) -> None:
        self.sym.clear()
        _tail.clear()

    def feed(self, symbol: str, ticks: List[LiveTick]) -> Optional[Update]:
        """Lô tick trực tiếp (tăng dần); trả những gì đổi, None nếu chưa có gốc / không có tick mới."""
        now = self.clock()
        s = self.sym.get(symbol)
        if s is None:
            s = self.sym[symbol] = _Sym(now)
        if s.acc is None:
            s.pending = (s.pending + ticks)[-PENDING_MAX:]
            if now - s.asked >= SEED_RETRY:
                s.asked, s.ask_seq = now, next(_seq)
                self.ask(symbol)
            adopted = self._adopt_tail(symbol, s)
            if not adopted and now - s.since >= SEED_WAIT:
                s.acc, adopted = Acc(), True
            return self._apply(s, [], True) if adopted else None
        return self._apply(s, ticks)

    def seed(self, symbol: str) -> Optional[Update]:
        """EA vừa trả lịch sử tick cho `symbol` (xem `ingest`): nếu đang chờ gốc thì nhận gốc đó và áp các tick trực tiếp đã giữ."""
        s = self.sym.get(symbol)
        if s is not None and s.acc is not None:
            _tail.pop(symbol, None)  # đang chạy rồi (lịch sử này do web xin tính lại): không dùng
            return None
        if s is None or not self._adopt_tail(symbol, s):
            return None
        return self._apply(s, [], True)

    def _adopt_tail(self, symbol: str, s: _Sym) -> bool:
        got = _tail.get(symbol)
        if got is None:
            return False
        acc, last_ms, seq = got
        if seq < s.ask_seq:
            return False  # nhận trước lần xin gần nhất: có thể thiếu tick từ lúc đó tới giờ
        del _tail[symbol]
        s.acc, s.last_ms, s.floor = acc, last_ms, last_ms
        return True

    def _apply(self, s: _Sym, ticks: List[LiveTick], started: bool = False) -> Optional[Update]:
        """Áp tick (kèm tick đã giữ) vào phút đang chạy; `started`: vừa có gốc nên báo trạng thái dù không có tick mới."""
        acc = s.acc
        assert acc is not None
        todo, s.pending = s.pending + ticks, []
        fresh = False
        for t, p, w, eq in todo:
            if t <= s.floor or t < s.last_ms or p <= 0 or (eq and p == acc.prev_price):
                continue
            acc.add(t, p, w)
            s.last_ms = t
            fresh = True
        closed, acc.closed = acc.closed, []
        if not fresh and not closed and not started:
            return None
        return Update(closed, acc.row(), acc.cells)
