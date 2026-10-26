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


def test_tickbig_keeps_the_biggest_cells_in_time_order():
    from app.store import BarStore

    st = BarStore(__import__("pathlib").Path(tempfile.mkdtemp()) / "b.sqlite")
    st.put_tickvp("S", 0, 180, [(0, 100.0, 2.0, 1.0), (0, 101.0, 0.0, 6.0), (60, 100.0, 4.0, 0.0), (120, 102.0, 1.0, 1.0), (180, 100.0, 50.0, 0.0)])
    # phút 180 ngoài [0, 180); min 3 bỏ ô có tổng < 3 (phút 120)
    assert st.tickbig("S", 0, 180, 3, 10) == [(0, 100.0, 2.0, 1.0), (0, 101.0, 0.0, 6.0), (60, 100.0, 4.0, 0.0)]
    # limit 2 giữ 2 ô lớn nhất (6 và 4) rồi sắp lại theo thời gian; symbol khác không lẫn
    assert st.tickbig("S", 0, 180, 1, 2) == [(0, 101.0, 0.0, 6.0), (60, 100.0, 4.0, 0.0)]
    assert st.tickbig("Other", 0, 180, 1, 2) == []


def test_tickbig_endpoint():
    sym = "TDBIG"
    # phút 0: giá 10 lên (so với pb 9), 12 lên, 11 xuống; phút 1: 11 bằng nên giữ xuống
    send_ea([{"type": "ticks_hist", "symbol": sym, "broker_utc_offset": 0, "t": [1000, 2000, 3000, 61000], "p": [10, 12, 11, 11], "pb": 9, "done": True}])
    c = TestClient(app)
    r = c.get("/tickbig", params={"symbol": sym, "from": 0, "to": 120, "min": 1, "limit": 10}).json()
    assert r == {"rows": [[0, 10.0, 1.0, 0.0], [0, 11.0, 0.0, 1.0], [0, 12.0, 1.0, 0.0], [60, 11.0, 0.0, 1.0]]}
    assert c.get("/tickbig", params={"symbol": sym, "from": 0, "to": 120, "min": 2, "limit": 10}).json() == {"rows": []}
    assert c.get("/tickbig", params={"symbol": sym, "from": 0, "to": 120, "limit": 0}).status_code == 422


def test_tickbig_groups_prices_into_rows():
    from app.store import BarStore

    st = BarStore(__import__("pathlib").Path(tempfile.mkdtemp()) / "b.sqlite")
    # phút 0: 100.2 (3 lên), 100.8 (1 lên, 2 xuống) cùng row [100, 101); 101.5 (4 xuống) row [101, 102); phút 60: 100.5 (2 lên)
    st.put_tickvp("S", 0, 60, [(0, 100.2, 3.0, 0.0), (0, 100.8, 1.0, 2.0), (0, 101.5, 0.0, 4.0), (60, 100.5, 2.0, 0.0)])
    rows = st.tickbig("S", 0, 120, 1, 10, 1.0)
    assert [(t, u, d) for t, _, u, d in rows] == [(0, 4.0, 2.0), (0, 0.0, 4.0), (60, 2.0, 0.0)]
    assert abs(rows[0][1] - (100.2 * 3 + 100.8 * 3) / 6) < 1e-9 and rows[1][1] == 101.5  # giá trung bình theo volume
    # min 5 chỉ còn row 100 của phút 0 (tổng 6); limit 1 giữ ô lớn nhất
    assert [(t, u, d) for t, _, u, d in st.tickbig("S", 0, 120, 5, 10, 1.0)] == [(0, 4.0, 2.0)]
    assert [(t, u, d) for t, _, u, d in st.tickbig("S", 0, 120, 1, 1, 1.0)] == [(0, 4.0, 2.0)]
    # size 0: đúng từng giá, không gom
    assert len(st.tickbig("S", 0, 120, 1, 10)) == 4


def test_tickstat_counts_cells_and_sums_their_volume():
    from app.store import BarStore

    st = BarStore(__import__("pathlib").Path(tempfile.mkdtemp()) / "b.sqlite")
    # phút 0: 100.2 (3), 100.8 (3), 101.5 (4); phút 60: 100.5 (2); phút 120 ngoài [0, 120)
    st.put_tickvp("S", 0, 120, [(0, 100.2, 3.0, 0.0), (0, 100.8, 1.0, 2.0), (0, 101.5, 0.0, 4.0), (60, 100.5, 2.0, 0.0), (120, 100.0, 50.0, 0.0)])
    assert st.tickstat("S", 0, 120) == (4, 12.0, 9 + 9 + 16 + 4)  # đúng từng giá: 4 ô 3, 3, 4, 2
    # gom row cao 1: phút 0 có row 100 (3 + 3 = 6) và row 101 (4); phút 60 row 100 (2)
    assert st.tickstat("S", 0, 120, 1.0) == (3, 12.0, 36 + 16 + 4)
    assert st.tickstat("S", 60, 120, 1.0) == (1, 2.0, 4.0)
    assert st.tickstat("Other", 0, 120) == (0, 0.0, 0.0)


def test_tickstat_endpoint():
    sym = "TDSTAT"
    send_ea([{"type": "ticks_hist", "symbol": sym, "broker_utc_offset": 0, "t": [1000, 2000, 3000, 61000], "p": [10, 12, 11, 11], "pb": 9, "done": True}])
    c = TestClient(app)
    assert c.get("/tickstat", params={"symbol": sym, "from": 0, "to": 120}).json() == {"n": 4, "sum": 4.0, "sumsq": 4.0}
    assert c.get("/tickstat", params={"symbol": sym, "from": 60, "to": 120}).json() == {"n": 1, "sum": 1.0, "sumsq": 1.0}
    assert c.get("/tickstat", params={"symbol": sym, "from": 0, "to": 120, "size": -1}).status_code == 422


def test_tickfp_groups_minutes_into_bars_and_price_rows():
    from app.store import BarStore

    st = BarStore(__import__("pathlib").Path(tempfile.mkdtemp()) / "b.sqlite")
    # nến 0 = [0, 120) gồm phút 0 và 60; nến 1 = [120, 240) gồm phút 120; phút 240 ngoài `end`
    st.put_tickvp("S", 0, 240, [(0, 100.2, 3.0, 0.0), (0, 100.8, 1.0, 2.0), (60, 100.5, 2.0, 0.0), (60, 101.5, 0.0, 4.0), (120, 99.5, 5.0, 1.0), (240, 100.0, 9.0, 9.0)])
    assert st.tickfp("S", [0, 120], 240, 1.0) == [(0, 100, 6.0, 2.0), (0, 101, 0.0, 4.0), (1, 99, 5.0, 1.0)]
    # nến cuối chỉ tới `end`; phút trước nến đầu không tính; symbol khác không lẫn
    assert st.tickfp("S", [60, 120], 120, 1.0) == [(0, 100, 2.0, 0.0), (0, 101, 0.0, 4.0)]
    assert st.tickfp("Other", [0, 120], 240, 1.0) == []
    assert st.tickfp("S", [], 240, 1.0) == [] and st.tickfp("S", [0], 240, 0) == [] and st.tickfp("S", [300], 240, 1.0) == []


def test_tickfp_endpoint():
    sym = "TDFP"
    # phút 0: 10 lên (pb 9), 12 lên, 11 xuống; phút 1: 11 bằng nên giữ xuống
    send_ea([{"type": "ticks_hist", "symbol": sym, "broker_utc_offset": 0, "t": [1000, 2000, 3000, 61000], "p": [10, 12, 11, 11], "pb": 9, "done": True}])
    c = TestClient(app)
    r = c.get("/tickfp", params={"symbol": sym, "bars": "0,60", "end": 120, "size": 2}).json()
    assert r == {"rows": [[0, 5, 1.0, 1.0], [0, 6, 1.0, 0.0], [1, 5, 0.0, 1.0]]}  # size 2: giá 10 (lên) và 11 (xuống) cùng row 5, 12 (lên) row 6
    for bad in ({"bars": "", "end": 120, "size": 1}, {"bars": "60,0", "end": 120, "size": 1}, {"bars": "x", "end": 120, "size": 1}, {"bars": "0", "end": 120, "size": 0}):
        assert c.get("/tickfp", params={"symbol": sym, **bad}).status_code == 422
    assert c.get("/tickfp", params={"symbol": sym, "bars": ",".join(str(i) for i in range(1001)), "end": 5000, "size": 1}).status_code == 422


# --- realtime (Live) -----------------------------------------------------------------------------------------------------------------------------------

def _live(asked):
    clock = [1000.0]
    return tickdelta.Live(lambda s: asked.append(s), lambda: clock[0]), clock


def test_live_accumulates_batches_like_classify_and_splits_minutes():
    asked = []
    live, clock = _live(asked)
    live.sym["S"] = tickdelta._Sym(clock[0])
    live.sym["S"].acc = tickdelta.Acc(99.5, 1)
    t = [1, 2, 3, 4, 5, M + 1, M + 2]
    p = [100, 101, 100, 100, 99, 100, 101]
    got = []
    for lo, hi in ((0, 2), (2, 5), (5, 7)):  # ba lô tick, lô giữa chưa tới phút 1, lô cuối sang phút 1
        got.append(live.feed("S", [(t[i], p[i], 1.0, False) for i in range(lo, hi)]))
    rows, _, _ = tickdelta.classify(t, p, None, 99.5, 1)
    assert got[0].closed == [] and got[0].row == {"t": 0, "o": 0.0, "h": 2.0, "l": 0.0, "c": 2.0, "v": 2.0}
    assert [r for r, _ in got[2].closed] == [rows[0]]  # phút 0 chốt đúng bằng classify cả đợt
    assert got[2].row == rows[1]
    assert asked == []  # đã có gốc nên không xin EA


def test_live_cells_are_the_minute_histogram():
    live, clock = _live([])
    live.sym["S"] = tickdelta._Sym(clock[0])
    live.sym["S"].acc = tickdelta.Acc(99.0, 1)
    upd = live.feed("S", [(1, 100.0, 2.0, False), (2, 101.0, 1.0, False), (3, 100.0, 1.0, False), (4, 100.0, 3.0, False)])
    assert upd.cells == {100.0: [2.0, 4.0], 101.0: [1.0, 0.0]}


def test_live_waits_for_ea_history_then_adopts_it_and_drops_duplicates():
    asked = []
    live, clock = _live(asked)
    assert live.feed("S", [(5, 11.0, 1.0, False), (6, 12.0, 1.0, False)]) is None  # chưa có gốc: giữ tick, xin EA
    assert asked == ["S"]
    # EA trả lịch sử tới tick lúc 6 ms (đã gồm hai tick trên) kèm tick 3 ms trước đó
    tickdelta.ingest(TicksHistIn(symbol="S", t=[3, 5, 6], p=[10.0, 11.0, 12.0], pb=9.0, done=True))
    upd = live.seed("S")
    assert upd.row == {"t": 0, "o": 0.0, "h": 3.0, "l": 0.0, "c": 3.0, "v": 3.0}  # 3 tick của EA, hai tick trực tiếp trùng không đếm lại
    # tick trực tiếp mới hơn thì tiếp nối; tick trùng thời điểm cuối của EA bị bỏ
    upd = live.feed("S", [(6, 12.0, 1.0, False), (7, 11.0, 1.0, False)])
    assert upd.row["c"] == 2.0 and upd.row["v"] == 4.0
    assert asked == ["S"]


def test_live_ignores_history_that_arrived_before_it_asked():
    asked = []
    live, clock = _live(asked)
    tickdelta.ingest(TicksHistIn(symbol="S", t=[3], p=[10.0], pb=9.0, done=True))  # web xin tính lại từ trước
    assert live.feed("S", [(5, 11.0, 1.0, False)]) is None
    assert live.seed("S") is None and asked == ["S"]
    tickdelta.ingest(TicksHistIn(symbol="S", t=[3, 4], p=[10.0, 10.5], pb=9.0, done=True))
    assert live.seed("S").row["c"] == 3.0  # 10 lên, 10.5 lên, 11 lên


def test_live_falls_back_to_live_ticks_when_ea_never_answers_and_asks_again():
    asked = []
    live, clock = _live(asked)
    assert live.feed("S", [(1, 5.0, 1.0, False)]) is None
    clock[0] += tickdelta.SEED_RETRY
    assert live.feed("S", [(2, 6.0, 1.0, False)]) is None and asked == ["S", "S"]
    clock[0] += tickdelta.SEED_WAIT
    upd = live.feed("S", [(3, 7.0, 1.0, False)])
    assert upd.row["v"] == 3.0 and upd.row["c"] == 3.0  # không biết giá trước: tick đầu theo chiều mặc định (lên)


def test_live_history_from_web_does_not_replace_a_running_minute_and_reset_asks_again():
    asked = []
    live, clock = _live(asked)
    live.sym["S"] = tickdelta._Sym(clock[0])
    live.sym["S"].acc = tickdelta.Acc(9.0, 1)
    live.feed("S", [(1, 10.0, 1.0, False)])
    tickdelta.ingest(TicksHistIn(symbol="S", t=[1], p=[10.0], pb=9.0, done=True))
    assert live.seed("S") is None
    assert live.feed("S", [(2, 11.0, 1.0, False)]).row["v"] == 2.0
    live.reset("S")
    assert live.feed("S", [(70_000, 12.0, 1.0, False)]) is None and asked == ["S"]


def test_live_skips_unchanged_price_when_flag_is_unknown():
    live, clock = _live([])
    live.sym["S"] = tickdelta._Sym(clock[0])
    live.sym["S"].acc = tickdelta.Acc(10.0, 1)
    upd = live.feed("S", [(1, 10.0, 1.0, True), (2, 11.0, 1.0, True), (3, 11.0, 1.0, True), (4, 11.0, 1.0, False)])
    assert upd.row["v"] == 2.0  # hai tick giá không đổi (ask đổi) bị bỏ, tick có cờ thì đếm


def test_live_ticks_over_tcp_are_saved_and_published(monkeypatch):
    import time

    from app import state

    sym = "TDLIVE"
    m = (int(time.time()) // 60 - 3) * 60  # đủ mới để qua MAX_TICK_AGE_MS
    ms = m * 1000
    sent = []
    monkeypatch.setattr(state.hub, "publish", lambda s, tf, msg: sent.append(msg))
    state.tick_live.reset(sym)
    send_ea([
        # tick trực tiếp trước khi có gốc; tick cuối chỉ đổi ask (cờ không có BID) nên không tính
        {"type": "ticks", "symbol": sym, "broker_utc_offset": 0, "ticks": [
            {"t_msc": ms + 59_000, "bid": 11, "f": 2}, {"t_msc": ms + 59_100, "bid": 11, "ask": 12, "f": 4}]},
        {"type": "ticks_hist", "symbol": sym, "broker_utc_offset": 0, "t": [ms + 58_900], "p": [10], "pb": 9, "done": True},
        # sang phút kế (cách tick trước dưới 60 giây, không bị coi là luồng tick đứt): phút cũ chốt, phút mới mở
        {"type": "ticks", "symbol": sym, "broker_utc_offset": 0, "ticks": [{"t_msc": ms + 60_500, "bid": 10, "f": 2}]},
    ])
    deltas = [x for x in sent if x["type"] == "tick_delta"]
    assert deltas[0]["bars"] == [{"t": m, "o": 0.0, "h": 2.0, "l": 0.0, "c": 2.0, "v": 2.0}]
    assert sorted(deltas[0]["cells"]) == [[10, 1.0, 0.0], [11, 1.0, 0.0]]
    last = deltas[-1]
    assert [b["t"] for b in last["bars"]] == [m, m + 60] and last["bars"][0]["c"] == 2.0 and last["bars"][1]["c"] == -1.0
    assert last["cells"] == [[10, 0.0, 1.0]]
    c = TestClient(app)
    rows = c.get("/bars", params={"symbol": sym, "tf": "TD"}).json()
    assert [(r["t"], r["c"], r["v"]) for r in rows] == [(m, 2.0, 2.0), (m + 60, -1.0, 1.0)]
    big = c.get("/tickbig", params={"symbol": sym, "from": m, "to": m + 120, "min": 1, "limit": 10}).json()["rows"]
    assert big == [[m, 10.0, 1.0, 0.0], [m, 11.0, 1.0, 0.0], [m + 60, 10.0, 0.0, 1.0]]


def test_live_last_mode_counts_trade_ticks_with_volume(monkeypatch):
    import time

    from app import state

    sym = "TDLAST"
    ms = (int(time.time()) // 60 - 3) * 60 * 1000
    sent = []
    monkeypatch.setattr(state.hub, "publish", lambda s, tf, msg: sent.append(msg))
    state.tick_live.reset(sym)
    state.tick_live.sym[sym] = tickdelta._Sym(0.0)
    state.tick_live.sym[sym].acc = tickdelta.Acc(100.0, 1)
    send_ea([{"type": "ticks", "symbol": sym, "broker_utc_offset": 0, "lm": True, "ticks": [
        {"t_msc": ms + 1, "bid": 99, "last": 101, "vol": 5, "f": 8}, {"t_msc": ms + 2, "bid": 98, "last": 101, "vol": 9, "f": 2},
        {"t_msc": ms + 3, "bid": 98, "last": 100, "vol": 0, "f": 8}]}])
    d = [x for x in sent if x["type"] == "tick_delta"][-1]
    # 101 lên x5; tick chỉ đổi bid bị bỏ; 100 xuống, volume 0 tính 1
    assert d["bars"][0]["c"] == 4.0 and d["bars"][0]["v"] == 6.0
