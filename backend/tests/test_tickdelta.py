import os
import tempfile

os.environ["TV_DATA_DIR"] = tempfile.mkdtemp()

from fastapi.testclient import TestClient  # noqa: E402

from app import tickdelta  # noqa: E402
from app.main import app  # noqa: E402
from app.models import TicksHistIn  # noqa: E402
from tests.test_basic import send_ea  # noqa: E402

M = 60_000  # một phút (ms)


def test_classify_up_down_flat_and_prefix_extremes():
    # phút 0: 100 -> 101 (lên) -> 100 (xuống) -> 100 (bằng: giữ xuống) -> 99 (xuống); phút 1: 100 (lên)
    t = [1, 2, 3, 4, 5, M + 1]
    p = [100, 101, 100, 100, 99, 100]
    rows, last_p, last_d = tickdelta.classify(t, p, None, 99.5, 1)
    # tick đầu 100 so với prev 99.5: lên (+1); 101 +1; 100 -1; 100 flat -> -1; 99 -1 => cum 1,2,1,0,-1
    assert rows[0] == {"t": 0, "o": 0.0, "h": 2.0, "l": -1.0, "c": -1.0, "v": 5.0}
    # phút 1 bắt đầu lại từ 0: 100 so với 99 là lên
    assert rows[1] == {"t": 60, "o": 0.0, "h": 1.0, "l": 0.0, "c": 1.0, "v": 1.0}
    assert (last_p, last_d) == (100, 1)


def test_classify_weights_and_unknown_previous():
    rows, _, d = tickdelta.classify([1, 2, 3], [10, 10, 9], [5, 0, 2], 0, 1)
    # không biết tick trước: tick đầu theo chiều mặc định (lên) x5; tick 2 bằng nên giữ lên, trọng số <= 0 thành 1; tick 3 xuống x2
    assert rows == [{"t": 0, "o": 0.0, "h": 6.0, "l": 0.0, "c": 4.0, "v": 8.0}]
    assert d == -1


def test_classify_skips_bad_prices_and_empty():
    assert tickdelta.classify([], [], None, 0, 1) == ([], 0, 1)
    rows, last_p, _ = tickdelta.classify([1, 2], [0, 5], None, 0, 1)
    assert rows[0]["v"] == 1.0 and last_p == 5


def test_ingest_offset_and_continuation():
    sym = "TDX"
    # offset 3h: time_msc server = utc + 3h. UTC phút 0 và 1
    off = 3 * 3600
    a = TicksHistIn(symbol=sym, broker_utc_offset=off, t=[(0 + off) * 1000 + 5, (0 + off) * 1000 + 6], p=[10, 11], pb=9.0)
    rows = tickdelta.ingest(a)
    assert rows == [{"t": 0, "o": 0.0, "h": 2.0, "l": 0.0, "c": 2.0, "v": 2.0}]
    # tiếp nối: tick đầu bằng giá cuối thông điệp trước (11) -> giữ chiều lên; không cont thì dùng pb
    b = TicksHistIn(symbol=sym, broker_utc_offset=off, t=[(60 + off) * 1000 + 1], p=[11], cont=True)
    assert tickdelta.ingest(b)[0]["c"] == 1.0
    c = TicksHistIn(symbol=sym, broker_utc_offset=off, t=[(120 + off) * 1000 + 1], p=[11], pb=12.0)
    assert tickdelta.ingest(c)[0]["c"] == -1.0
    # giá bằng pb: giữ chiều pd của tick trước cửa sổ
    d = TicksHistIn(symbol=sym, broker_utc_offset=off, t=[(180 + off) * 1000 + 1], p=[12], pb=12.0, pd=-1)
    assert tickdelta.ingest(d)[0]["c"] == -1.0


def test_ticks_hist_over_tcp_is_stored_and_served():
    sym = "TDTCP"
    send_ea([{"type": "ticks_hist", "symbol": sym, "broker_utc_offset": 0, "t": [1000, 2000, 61000], "p": [10, 12, 11], "pb": 10, "done": True}])
    c = TestClient(app)
    rows = c.get("/bars", params={"symbol": sym, "tf": "TD"}).json()
    assert [(r["t"], r["c"], r["h"], r["l"], r["v"]) for r in rows] == [(0, 2.0, 2.0, 0.0, 2.0), (60, -1.0, 0.0, -1.0, 1.0)]
    assert c.get("/bars", params={"symbol": sym, "tf": "M1"}).json() == []  # không lẫn vào nến thường
    assert c.get("/bars", params={"symbol": sym, "tf": "XX"}).status_code == 400
