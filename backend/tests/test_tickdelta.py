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


def test_classify_histogram_splits_weight_by_direction_per_minute_and_price():
    hist = {}
    # phút 0: 100 (lên, trọng số 2), 101 (lên), 100 (xuống), 100 (bằng: giữ xuống, trọng số 3); phút 1: 100 (lên so với tick trước? bằng: giữ xuống)
    tickdelta.classify([1, 2, 3, 4, M + 1], [100, 101, 100, 100, 100], [2, 1, 1, 3, 1], 99.0, 1, hist)
    assert hist == {(0, 100): [2.0, 4.0], (0, 101): [1.0, 0.0], (60, 100): [0.0, 1.0]}
    # tổng volume mỗi phút khớp v của nến TD
    rows, _, _ = tickdelta.classify([1, 2, 3, 4, M + 1], [100, 101, 100, 100, 100], [2, 1, 1, 3, 1], 99.0, 1)
    assert [r["v"] for r in rows] == [7.0, 1.0]


def test_tickvp_store_buckets_rows_and_clamps():
    from app.store import BarStore

    st = BarStore(__import__("pathlib").Path(tempfile.mkdtemp()) / "b.sqlite")
    st.put_tickvp("S", 0, 60, [(0, 100.0, 2.0, 1.0), (0, 100.4, 1.0, 0.0), (0, 101.0, 0.0, 3.0), (60, 103.0, 5.0, 0.0), (120, 100.0, 9.0, 9.0)])
    # row 0 = [100, 101), row 1 = [101, 102), row 2 = [102, 103): 103 nằm đúng mép trên -> row 3 bị cắt về row cuối; phút 120 ngoài [0, 120)
    up, dn = st.tickvp("S", 0, 120, 100.0, 1.0, 3)
    assert up == [3.0, 0.0, 5.0] and dn == [1.0, 3.0, 0.0]
    # lo = 100.5: row 0 = [100.5, 101.5) nhận 101.0 cùng 100.0 và 100.4 (thấp hơn lo nên dồn vào row đầu); 103 nằm trong row 2 = [102.5, 103.5)
    up, dn = st.tickvp("S", 0, 120, 100.5, 1.0, 3)
    assert up == [3.0, 0.0, 5.0] and dn == [4.0, 0.0, 0.0]
    # ghi lại phút 0 với ít giá hơn: phút cũ bị thay, không còn dòng thừa
    st.put_tickvp("S", 0, 0, [(0, 100.0, 7.0, 0.0)])
    up, dn = st.tickvp("S", 0, 120, 100.0, 1.0, 3)
    assert up == [7.0, 0.0, 5.0] and dn == [0.0, 0.0, 0.0]


def test_tickvp_old_td_bars_dropped_when_table_is_new_and_old_data_pruned():
    import pathlib
    import sqlite3

    from app.store import BarStore, TICK_KEEP

    path = pathlib.Path(tempfile.mkdtemp()) / "old.sqlite"
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE bars (symbol TEXT NOT NULL, tf TEXT NOT NULL, t INTEGER NOT NULL, o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL, PRIMARY KEY (symbol, tf, t)) WITHOUT ROWID")
    db.executemany("INSERT INTO bars VALUES (?,?,?,1,1,1,1,1)", [("S", "TD", 0), ("S", "M1", 0)])
    db.commit()
    db.close()
    st = BarStore(path)  # chưa có bảng tickvp: nến TD cũ (không có histogram) bị bỏ, nến thường giữ
    assert st.query("S", "TD") == [] and len(st.query("S", "M1")) == 1
    st.upsert("S", "TD", [{"t": 0, "o": 0, "h": 0, "l": 0, "c": 0, "v": 1}, {"t": TICK_KEEP + 120, "o": 0, "h": 0, "l": 0, "c": 0, "v": 1}])
    st.put_tickvp("S", 0, 0, [(0, 5.0, 1.0, 0.0)])
    st.put_tickvp("S", TICK_KEEP + 120, TICK_KEEP + 120, [(TICK_KEEP + 120, 5.0, 1.0, 0.0)])  # phút mới đẩy phút 0 ra khỏi thời hạn giữ
    assert st.tickvp("S", 0, 60, 5.0, 1.0, 1) == ([0.0], [0.0])
    assert [b["t"] for b in st.query("S", "TD")] == [TICK_KEEP + 120]


def test_ticks_hist_over_tcp_feeds_tickvp_endpoint():
    sym = "TDVP"
    # 4 tick: 10 (lên so với pb 9), 12 (lên), 11 (xuống) trong phút 0; 11 (bằng: giữ xuống) phút 1
    send_ea([{"type": "ticks_hist", "symbol": sym, "broker_utc_offset": 0, "t": [1000, 2000, 3000, 61000], "p": [10, 12, 11, 11], "pb": 9, "done": True}])
    c = TestClient(app)
    r = c.get("/tickvp", params={"symbol": sym, "from": 0, "to": 120, "lo": 10, "size": 1, "n": 3}).json()
    assert r == {"up": [1.0, 0.0, 1.0], "dn": [0.0, 2.0, 0.0]}
    assert c.get("/tickvp", params={"symbol": sym, "from": 60, "to": 120, "lo": 10, "size": 1, "n": 3}).json() == {"up": [0.0, 0.0, 0.0], "dn": [0.0, 1.0, 0.0]}
    assert c.get("/tickvp", params={"symbol": sym, "from": 0, "to": 120, "lo": 10, "size": 0, "n": 3}).status_code == 422
