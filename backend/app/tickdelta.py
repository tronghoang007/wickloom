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

from .config import round_offset
from .models import TicksHistIn

TICK_DELTA_TF = "TD"

# symbol -> bộ gom cuối thông điệp trước (giá / chiều của tick cuối + phút đang mở), dùng cho thông điệp `cont` kế tiếp cùng một yêu cầu:
# EA cắt thông điệp quá dài ngay giữa phút (hiếm), phần sau phải cộng tiếp vào phút đó chứ không thay nó
_carry: Dict[str, "Acc"] = {}

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


# symbol -> (Acc của phút cuối thông điệp `done`, UTC ms của tick cuối, số thứ tự lúc nhận, UTC ms cuối cửa sổ EA đọc hoặc None): gốc cho `Live.seed`
_tail: Dict[str, Tuple[Acc, int, int, Optional[int]]] = {}
_seq = itertools.count(1)  # thứ tự nhận lịch sử tick và thứ tự xin EA: chỉ lịch sử nhận SAU lần xin mới là "tới giờ hiện tại"


def ingest(body: TicksHistIn, hist: Optional[Dict[Tuple[int, float], List[float]]] = None) -> List[Dict[str, Any]]:
    """Phân loại một thông điệp `ticks_hist` -> các dòng bars tf "TD" (người gọi ghi vào kho) và, nếu có `hist`, histogram giá theo phút.
    EA thường cắt thông điệp ở ranh giới phút; phút quá nhiều tick bị cắt giữa chừng thì thông điệp `cont` sau cộng tiếp vào phút đó (dòng của phút đó được ghi lại đủ)."""
    off = round_offset(body.broker_utc_offset) * 1000
    t = [x - off for x in body.t]
    cont = _carry.get(body.symbol) if body.cont else None
    acc = _copy(cont) if cont else Acc(body.pb, -1 if body.pd < 0 else 1)
    _run(acc, t, body.p, body.w)
    _carry[body.symbol] = _copy(acc)
    last = acc.row()
    if body.done and last is not None:
        _tail[body.symbol] = (_copy(acc), max(t), next(_seq), body.end)
    elif body.done and body.end is not None:  # cửa sổ không có tick nào (EA >= 2.20 vẫn báo xong): gốc rỗng, chỉ có giá / chiều trước cửa sổ
        _tail[body.symbol] = (_copy(acc), 0, next(_seq), body.end)
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
# Gốc phải chạm tới gần tick trực tiếp đầu tiên đang giữ (Live xin 2 phút tới giờ hiện tại). Lịch sử dừng sớm hơn thế là trả lời cho một yêu cầu khác
# (web / GapFill xin một khoảng trong quá khứ, EA trả sau lần xin của Live): nhận làm gốc thì phút đang chạy thiếu tick, và lô ghi đầu tiên trải từ phút cũ đó tới giờ
SEED_SPAN_MS = 180_000


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
        acc, last_ms, seq, end = got
        if seq < s.ask_seq:
            return False  # nhận trước lần xin gần nhất: có thể thiếu tick từ lúc đó tới giờ
        reach = end if end is not None else last_ms  # EA cũ không báo cuối cửa sổ: lấy tick cuối (thị trường im > 3 phút thì đợi SEED_WAIT rồi tính từ tick trực tiếp)
        if s.pending and reach < s.pending[0][0] - SEED_SPAN_MS:
            return False  # lịch sử của một khoảng trong quá khứ, không phải gốc tới giờ hiện tại
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


# --- lấp lịch sử tick của khoảng đứt ----------------------------------------------------------------------------------------------------------------------

GAP_MIN = 120  # giây: luồng tick đứt ngắn hơn thì gốc 2 phút của `Live` đã phủ, khỏi xin thêm
GAP_MARGIN = 180  # giây dư trước lúc luồng tick đứt
GAP_TTL = 600  # giây: quá lâu mà EA không trả đoạn tiếp theo thì bỏ


class GapFill:
    """Lấp tick (tf "TD") của khoảng luồng tick bị đứt (máy ngủ, EA mất kết nối: MT5 vẫn có tick của broker). EA nạp đồng bộ trong OnTimer nên tick tạm dừng suốt lúc đó:
    chỉ xin MỘT đoạn `chunk` phút một lần. Đoạn đầu lùi từ hiện tại; EA gửi xong (`done`) thì đoạn kế lùi từ dòng cũ nhất vừa nhận (`before` = ngay trước nó) và dừng khi đã phủ tới trước lúc đứt,
    nên khoảng đứt qua cuối tuần / giờ nghỉ (EA đếm theo nến M1, nhảy qua chỗ đóng cửa) chỉ tốn một đoạn thay vì nhiều đoạn trùng cửa sổ. Tối đa `max_chunks` đoạn.
    `ask(symbol, minutes, before)` xin EA; người gọi báo `note` (các dòng TD vừa nhận) và `done` (yêu cầu tick hoàn tất)."""

    def __init__(self, ask: Callable[[str, int, int], None], chunk: int = 360, max_chunks: int = 4, clock: Callable[[], float] = time.time) -> None:
        self.ask, self.chunk, self.max_chunks, self.clock = ask, chunk, max_chunks, clock
        self.jobs: Dict[str, Dict[str, Any]] = {}
        self.started: Dict[str, float] = {}  # symbol -> lúc bắt đầu lần lấp gần nhất (job xong thì xoá khỏi `jobs`, báo lặp vẫn phải bỏ qua)

    def start(self, symbol: str, gap_seconds: int, now: float) -> None:
        """Luồng tick của `symbol` vừa đứt `gap_seconds` giây rồi nối lại lúc `now`. Báo lặp trong 30s thì bỏ qua."""
        if gap_seconds < GAP_MIN:
            return
        if now - self.started.get(symbol, -1e18) < 30:
            return
        self.started[symbol] = now
        self.jobs[symbol] = {
            "at": now,
            "until": now - gap_seconds - GAP_MARGIN,  # dòng TD cũ hơn mốc này là đã phủ hết khoảng đứt
            "cutoff": now - 180,  # chỉ dòng cũ hơn mốc này tính là của đoạn đã xin (dòng gần đây là gốc 2 phút của `Live`)
            "left": self.max_chunks - 1,
            "oldest": None,  # phút TD cũ nhất nhận được từ đầu
            "sent": None,  # `oldest` lúc xin đoạn gần nhất
        }
        self.ask(symbol, min(self.chunk, gap_seconds // 60 + 3), int(now))

    def note(self, symbol: str, rows: List[Row]) -> None:
        """Các dòng TD vừa nhận cho `symbol` (tăng dần theo t)."""
        job = self.jobs.get(symbol)
        if job is None:
            return
        old = [r["t"] for r in rows if r["t"] < job["cutoff"]]
        if old:
            job["oldest"] = min(old) if job["oldest"] is None else min(job["oldest"], min(old))

    def done(self, symbol: str) -> None:
        """EA gửi xong một yêu cầu tick của `symbol`: có dòng cũ hơn đoạn trước và chưa phủ tới trước lúc đứt thì xin đoạn kế."""
        job = self.jobs.get(symbol)
        if job is None:
            return
        if self.clock() - job["at"] > GAP_TTL:
            del self.jobs[symbol]
            return
        oldest, sent = job["oldest"], job["sent"]
        if oldest is None or (sent is not None and oldest >= sent):
            return  # chưa có dòng nào của đoạn vừa xin (đây là `done` của yêu cầu khác, hoặc EA không có tick ở đó)
        if oldest <= job["until"] or job["left"] <= 0:
            del self.jobs[symbol]
            return
        job["left"] -= 1
        job["sent"] = oldest
        self.ask(symbol, min(self.chunk, int(oldest - job["until"]) // 60 + 3), oldest - 1)

    def clear(self) -> None:
        self.jobs.clear()
        self.started.clear()
