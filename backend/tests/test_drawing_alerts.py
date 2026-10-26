import math
import random
import time

import pytest
from fastapi.testclient import TestClient

from app import accounts, alerts, geometry, mt5, notify, state, tcp_server
from app.aggregator import bar_open
from app.alerts import Alert, Engine
from app.main import app
from app.models import TicksIn
from app.notify import Fired

ORIGIN = {"Origin": "http://localhost:3000"}
PW = "correct horse"
SYM = "XAUUSDm"
T0 = 1_800_000_000  # đầu một phút
STEP = 60


@pytest.fixture(autouse=True)
def clean():
    with state.meta.tx() as db:
        for t in ("alerts", "alert_log", "notify_channels", "sessions", "users"):
            db.execute(f"DELETE FROM {t}")
    alerts.engine._by_symbol.clear()
    state.symbols[SYM] = {"name": SYM}
    state.pending_backfill.clear()
    mt5.registry.clear()
    alerts.dispatcher._q.queue.clear()
    alerts._last_test.clear()
    real = accounts.PBKDF2_ITER
    accounts.PBKDF2_ITER = 1_000
    yield
    accounts.PBKDF2_ITER = real
    state.symbols.pop(SYM, None)
    alerts.engine._by_symbol.clear()
    state.pending_backfill.clear()


def spec(typ="trendline", pts=((0, 100.0), (600, 110.0)), ext="right", log=False, **kw):
    return {"id": "d1", "layout": "L", "type": typ, "label": "Trend Line", "pts": [list(p) for p in pts], "ext": ext, "log": log, **kw}


# --- hình học ---------------------------------------------------------------------------------------------------------------------------------------

def test_clean_spec_normalises_and_rejects_junk():
    s = geometry.clean_spec({"id": "x", "type": "trendline", "pts": [[100.7, 1], [200, 2.5]], "ext": "left", "label": "  A\nB  "})
    assert s == {"id": "x", "layout": "", "type": "trendline", "label": "AB", "pts": [[100, 1.0], [200, 2.5]], "ext": "left", "log": False}
    assert geometry.clean_spec({"type": "hline", "pts": [[5, 3]]})["label"] == "hline" and geometry.clean_spec({"type": "hline", "pts": [[5, 3]]})["id"] is None
    bad = [None, "x", {}, {"type": "fib", "pts": [[1, 1], [2, 2]]}, {"type": "trendline", "pts": [[1, 1]]}, {"type": "trendline", "pts": [[1, 1], [2, "x"]]},
           {"type": "trendline", "pts": [[1, 1], [2, float("nan")]]}, {"type": "trendline", "pts": [[1, 1], [2, True]]}, {"type": "trendline", "pts": [[1, 1], [2, 1e13]]},
           {"type": "trendline", "pts": [[-1, 1], [2, 1]]}, {"type": "trendline", "pts": [[1, 1], [2, 1]], "ext": "up"}, {"type": "trendline", "pts": [[1, 1], [2, 1]], "id": ""},
           {"type": "channel", "pts": [[1, 1], [2, 1]]}]
    for raw in bad:
        with pytest.raises(ValueError):
            geometry.clean_spec(raw)


def test_conds_depend_on_the_kind_of_shape():
    assert geometry.conds_for(spec()) == geometry.LINE_CONDS and geometry.conds_for(spec("hline", [(5, 1.0)])) == geometry.LINE_CONDS
    assert geometry.conds_for(spec("rect", [(0, 1.0), (5, 2.0)])) == geometry.BAND_CONDS and geometry.conds_for(spec("channel", [(0, 1.0), (5, 2.0), (3, 3.0)])) == geometry.BAND_CONDS


def test_line_price_follows_candle_index_not_clock_time():
    s = geometry.clean_spec(spec())
    # hai điểm neo cách nhau 10 nến: ở nến thứ 5 giá = 105, ở nến 20 (kéo dài sang phải) = 120
    assert geometry.geometry(s, [0.0, 10.0], 5.0) == ("ok", 105.0, 105.0)
    assert geometry.geometry(s, [0.0, 10.0], 20.0) == ("ok", 120.0, 120.0)
    # điểm neo nhập ngược thứ tự thì kết quả như nhau
    rev = geometry.clean_spec(spec(pts=((600, 110.0), (0, 100.0))))
    assert geometry.geometry(rev, [10.0, 0.0], 5.0) == ("ok", 105.0, 105.0)


def test_segment_ends_but_extended_lines_do_not():
    seg = geometry.clean_spec(spec(ext="none"))
    assert geometry.geometry(seg, [0.0, 10.0], 10.0)[0] == "ok" and geometry.geometry(seg, [0.0, 10.0], 10.5)[0] == "done"
    assert geometry.geometry(seg, [5.0, 10.0], 2.0)[0] == "wait"  # chưa tới điểm bắt đầu
    left = geometry.clean_spec(spec(ext="left"))
    assert geometry.geometry(left, [5.0, 10.0], 2.0) == ("ok", 94.0, 94.0)  # kéo dài sang trái: không chờ, đường đi tiếp với độ dốc 2 / nến
    assert geometry.geometry(left, [5.0, 10.0], 12.0)[0] == "done"
    both = geometry.clean_spec(spec(ext="both"))
    assert geometry.geometry(both, [5.0, 10.0], 2.0)[0] == "ok" and geometry.geometry(both, [5.0, 10.0], 99.0)[0] == "ok"


def test_horizontal_line_and_ray():
    assert geometry.geometry(geometry.clean_spec(spec("hline", [(0, 50.0)])), [3.0], -100.0) == ("ok", 50.0, 50.0)
    ray = geometry.clean_spec(spec("hray", [(0, 50.0)]))
    assert geometry.geometry(ray, [3.0], 1.0)[0] == "wait" and geometry.geometry(ray, [3.0], 3.0) == ("ok", 50.0, 50.0) and geometry.geometry(ray, [3.0], 999.0)[0] == "ok"


def test_log_scale_line_is_straight_in_log_price():
    s = geometry.clean_spec(spec(pts=((0, 100.0), (600, 400.0)), log=True))
    st, lo, hi = geometry.geometry(s, [0.0, 10.0], 5.0)
    assert st == "ok" and lo == pytest.approx(200.0) and hi == lo  # trung bình nhân, không phải 250
    lin = geometry.clean_spec(spec(pts=((0, 100.0), (600, 400.0)), log=False))
    assert geometry.geometry(lin, [0.0, 10.0], 5.0)[1] == pytest.approx(250.0)
    neg = geometry.clean_spec(spec(pts=((0, -5.0), (600, 5.0)), log=True))  # giá <= 0: không dùng được log, quay về tuyến tính
    assert geometry.geometry(neg, [0.0, 10.0], 5.0)[1] == pytest.approx(0.0)


def test_channel_is_two_parallel_lines_through_the_third_point():
    s = geometry.clean_spec(spec("channel", [(0, 100.0), (600, 110.0), (300, 112.0)], ext="right"))
    # đường gốc qua (0,100) và (10,110); điểm thứ ba ở nến 5 giá 112 -> đường gốc ở nến 5 là 105, lệch +7
    assert geometry.geometry(s, [0.0, 10.0, 5.0], 5.0) == ("ok", 105.0, 112.0)
    assert geometry.geometry(s, [0.0, 10.0, 5.0], 10.0) == ("ok", 110.0, 117.0)  # hai đường cùng độ dốc
    below = geometry.clean_spec(spec("channel", [(0, 100.0), (600, 110.0), (300, 100.0)], ext="right"))
    assert geometry.geometry(below, [0.0, 10.0, 5.0], 5.0) == ("ok", 100.0, 105.0)  # điểm thứ ba nằm dưới: dải vẫn là [thấp, cao]


def test_rectangle_is_a_fixed_price_band_within_its_time_span():
    r = geometry.clean_spec(spec("rect", [(0, 110.0), (600, 100.0)], ext="none"))
    assert geometry.geometry(r, [0.0, 10.0], 5.0) == ("ok", 100.0, 110.0)
    assert geometry.geometry(r, [0.0, 10.0], 11.0)[0] == "done" and geometry.geometry(r, [4.0, 10.0], 2.0)[0] == "wait"
    assert geometry.geometry(geometry.clean_spec(spec("rect", [(0, 110.0), (600, 100.0)], ext="right")), [0.0, 10.0], 50.0) == ("ok", 100.0, 110.0)


def test_band_conditions():
    band = (100.0, 110.0)
    h = lambda cond, prev, p, pb=band: geometry.hit_band(cond, prev, pb, p, band)
    assert h("enter", 95, 105) and not h("enter", 105, 108) and not h("enter", 95, 98) and h("enter", 115, 110)  # chạm biên cũng là vào
    assert h("exit", 105, 111) and h("exit", 105, 99) and not h("exit", 95, 111)
    assert h("cross", 95, 105) and h("cross", 95, 115) and h("cross", 115, 95) and not h("cross", 105, 108) and not h("cross", 95, 98)  # nhảy qua cả dải cũng là cắt
    assert h("inside", None, 105, None) and not h("inside", None, 95, None) and h("outside", None, 95, None) and not h("outside", None, 105, None)
    for cond in ("enter", "exit", "cross"):
        assert not geometry.hit_band(cond, None, None, 105, band)  # tick đầu chỉ làm mốc
    assert geometry.hit_band("enter", 105, (90.0, 96.0), 105, band)  # dải dịch lên che đúng chỗ giá đứng yên: tính là vào


# --- chỉ số nến từ DB giống hệt web -----------------------------------------------------------------------------------------------------------------------

def ts_logical(bars, step, t):
    """Bản port nguyên văn timeToLogical của web/src/drawings/coords.ts."""
    n = len(bars)
    if t <= bars[0]:
        return (t - bars[0]) / step
    if t >= bars[n - 1]:
        return n - 1 + (t - bars[n - 1]) / step
    lo, hi = 0, n - 1
    while hi - lo > 1:
        mid = (lo + hi) >> 1
        if bars[mid] <= t:
            lo = mid
        else:
            hi = mid
    return lo + (t - bars[lo]) / (bars[hi] - bars[lo])


def seed_bars(symbol, tf, times):
    state.bars.upsert(symbol, tf, [{"t": t, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1} for t in times])


def drop_bars(symbol, tf):
    with state.bars._lock:
        state.bars.db.execute("DELETE FROM bars WHERE symbol=? AND tf=?", (symbol, tf))
        state.bars.db.commit()


@pytest.mark.parametrize("seed", range(6))
@pytest.mark.parametrize("virtual", [False, True])
def test_db_candle_index_matches_the_web_function(seed, virtual):
    rnd = random.Random(seed)
    sym = f"LOGIC{seed}{int(virtual)}"
    times, t = [], T0
    for _ in range(60):  # nến liên tục, thỉnh thoảng nghỉ (cuối tuần): bước nhảy lớn
        times.append(t)
        t += STEP * (1 if rnd.random() > 0.15 else rnd.randint(2, 400))
    now_bar = times[-1] + (STEP * rnd.randint(1, 30) if virtual else 0)
    seed_bars(sym, "M1", times)
    try:
        queries = [rnd.randint(times[0] - 500, now_bar + 500) for _ in range(12)] + [times[0], times[-1], times[5], now_bar]
        pts, l_now = state.bars.logical(sym, "M1", queries, STEP, now_bar)
        web_bars = times + ([now_bar] if virtual else [])  # web luôn có nến đang chạy ở cuối
        ref = [ts_logical(web_bars, STEP, q) for q in queries]
        ref_now = len(web_bars) - 1
        for got, want in zip(pts, ref):  # gốc khác nhau: so hiệu số
            assert got - pts[0] == pytest.approx(want - ref[0], abs=1e-9)
        assert l_now - pts[0] == pytest.approx(ref_now - ref[0], abs=1e-9)
    finally:
        drop_bars(sym, "M1")


def test_candle_index_is_none_without_bars():
    assert state.bars.logical("NOBARS", "M1", [T0], STEP, T0) is None


# --- engine -----------------------------------------------------------------------------------------------------------------------------------------

class Rig:
    """Engine với đồng hồ giả và `logical` giả: nến k của rig có chỉ số nến k (mỗi phút một nến liên tục)."""

    def __init__(self, drawing, cond="cross_up", trigger="once", anchors=(0.0, 10.0, 5.0), **kw):
        self.clock = [float(T0)]
        self.fired, self.saved = [], []
        self.anchors = list(anchors)
        self.engine = Engine(self.fired.append, lambda a: self.saved.append((a.id, a.state)), lambda: self.clock[0], logical=self.logical)
        a = Alert(id="d", user_id="u", symbol=SYM, cond=cond, level=1.0, trigger=trigger, tf="M1", expires_at=None, name="", message="",
                  channels={"web": True, "telegram": False, "mt5": False}, state="active", created_at=T0, drawing=geometry.clean_spec(drawing), **kw)
        self.alert = a
        self.engine.load([a])

    def logical(self, symbol, tf, times, step, now_bar):
        return self.anchors[: len(times)], (now_bar - T0) / step

    def tick(self, price, minute=0, sec=1.0):
        self.clock[0] = T0 + minute * STEP + sec
        self.engine.on_price(SYM, int(self.clock[0] * 1000), price, 0)

    def close(self, minute, c):
        self.engine.on_bar_close(SYM, "M1", {"t": T0 + minute * STEP, "o": c, "h": c, "l": c, "c": c, "v": 1})


def test_line_alert_fires_when_price_crosses_the_line_at_the_current_candle():
    r = Rig(spec())  # đường: nến 0 -> 100, nến 10 -> 110, kéo dài sang phải
    r.tick(104.0, minute=5)  # đường ở nến 5 là 105: giá dưới đường, chỉ làm mốc
    r.tick(104.9, minute=5)
    assert r.fired == []
    r.tick(105.1, minute=5)
    assert [f.price for f in r.fired] == [105.1]
    assert r.fired[0].alert["now"] == [105.0, 105.0] and r.fired[0].alert["state"] == "triggered" and r.saved == [("d", "triggered")]


def test_line_moves_up_through_a_resting_price_counts_as_a_cross():
    r = Rig(spec(), cond="cross_down", trigger="every_time")  # giá đứng yên 103: đường đi từ dưới 103 lên trên 103 -> giá chuyển từ trên đường xuống dưới đường
    r.tick(103.0, minute=2)  # đường ở nến 2 = 102 -> giá trên đường
    r.tick(103.0, minute=2, sec=2)
    assert r.fired == []
    r.tick(103.0, minute=4)  # đường ở nến 4 = 104 -> giá nằm dưới đường: cắt xuống
    assert len(r.fired) == 1 and r.fired[0].alert["now"] == [104.0, 104.0]


def test_gt_lt_use_the_line_level():
    gt = Rig(spec(), cond="gt")
    gt.tick(104.0, minute=5)
    assert gt.fired == []
    gt.tick(105.5, minute=5)
    assert len(gt.fired) == 1
    lt = Rig(spec(), cond="lt")
    lt.tick(105.5, minute=5)
    assert lt.fired == []
    lt.tick(104.0, minute=5)
    assert len(lt.fired) == 1


def test_segment_alert_expires_after_its_last_anchor():
    r = Rig(spec(ext="none"))
    r.tick(99.0, minute=9)
    assert r.alert.state == "active"
    r.tick(99.0, minute=11)  # nến 11 đã qua điểm neo cuối (nến 10), hình không kéo dài sang phải
    assert r.fired == [] and r.alert.state == "expired" and r.saved == [("d", "expired")] and r.engine.symbols() == set()


def test_alert_waits_until_the_shape_starts():
    r = Rig(spec(pts=((600, 100.0), (1200, 110.0)), ext="none"), cond="gt", anchors=(10.0, 20.0))
    r.tick(150.0, minute=3)  # hình bắt đầu ở nến 10
    assert r.fired == [] and r.alert.state == "active"
    r.tick(150.0, minute=12)
    assert len(r.fired) == 1


def test_rectangle_enter_and_exit():
    rect = spec("rect", [(0, 110.0), (600, 100.0)], ext="right")
    enter = Rig(rect, cond="enter", anchors=(0.0, 10.0))
    enter.tick(95.0, minute=2)
    enter.tick(99.0, minute=2, sec=2)
    assert enter.fired == []
    enter.tick(101.0, minute=2, sec=3)
    assert len(enter.fired) == 1 and enter.fired[0].alert["now"] == [100.0, 110.0]
    leave = Rig(rect, cond="exit", anchors=(0.0, 10.0))
    leave.tick(105.0, minute=2)
    leave.tick(106.0, minute=2, sec=2)
    assert leave.fired == []
    leave.tick(111.0, minute=2, sec=3)
    assert len(leave.fired) == 1
    inside = Rig(rect, cond="inside", anchors=(0.0, 10.0))
    inside.tick(105.0, minute=2)
    assert len(inside.fired) == 1  # trạng thái: đang ở trong thì nổ ngay


def test_channel_cross_uses_both_edges_that_move_with_the_candle():
    ch = spec("channel", [(0, 100.0), (600, 110.0), (300, 112.0)], ext="right")
    r = Rig(ch, cond="cross", trigger="every_time", anchors=(0.0, 10.0, 5.0))
    r.tick(104.0, minute=5)  # dải ở nến 5 = [105, 112]: giá dưới dải
    r.tick(104.5, minute=5, sec=9)
    assert r.fired == []
    r.tick(106.0, minute=5, sec=18)  # vào dải
    assert len(r.fired) == 1


def test_per_bar_trigger_on_a_drawing_alert():
    r = Rig(spec(), cond="cross", trigger="once_per_bar")
    r.tick(104.0, minute=5)
    r.tick(106.0, minute=5, sec=2)
    r.tick(104.0, minute=5, sec=3)
    r.tick(106.0, minute=5, sec=4)  # cùng nến: bỏ qua
    assert len(r.fired) == 1


def test_bar_close_trigger_compares_the_close_with_that_candles_line():
    r = Rig(spec(), cond="cross_up", trigger="once_per_bar_close")
    r.tick(100.0, minute=3)
    r.close(3, 101.5)  # đường ở nến 3 = 103; lần đóng đầu chỉ làm mốc
    r.tick(104.0, minute=4)
    assert r.fired == []
    r.close(4, 104.5)  # đường ở nến 4 = 104; 101.5 dưới 103, 104.5 trên 104: cắt lên
    assert [f.price for f in r.fired] == [104.5]


def test_restart_resets_the_reference_for_drawing_alerts():
    r = Rig(spec(), cond="cross_up")
    r.tick(106.0, minute=5)  # sau khởi động tick đầu nằm trên đường: chỉ làm mốc, không bắn nhầm
    assert r.fired == []


def test_missing_candles_leave_the_alert_waiting():
    r = Rig(spec(), cond="gt")
    r.engine.logical = lambda *a: None
    r.tick(500.0, minute=5)
    assert r.fired == [] and r.alert.band is None and r.alert.state == "active"


def test_catchup_pairs_only_include_drawing_alerts():
    r = Rig(spec())
    assert r.engine.bar_pairs() == {(SYM, "M1")}
    r.alert.drawing = None
    assert r.engine.bar_pairs() == set()


# --- thông báo ---------------------------------------------------------------------------------------------------------------------------------------

def test_notification_text_names_the_shape_and_its_level_or_band():
    line = {"symbol": SYM, "cond": "cross_up", "level": 105.0, "name": "", "message": "", "drawing": {"label": "Trend Line", "type": "trendline"}, "now": [105.25, 105.25]}
    assert notify.condition_text(line) == "XAUUSDm Crossing Up Trend Line (105.25)"
    band = {**line, "cond": "enter", "drawing": {"label": "Rectangle", "type": "rect"}, "now": [100.0, 110.0]}
    assert notify.condition_text(band) == "XAUUSDm Entering Rectangle (100–110)"
    assert notify.condition_text({"symbol": SYM, "cond": "gt", "level": 4000.5}) == "XAUUSDm Greater Than 4000.5"
    f = Fired({**band, "id": "x", "user_id": "u", "channels": {}}, 101.0, T0)
    assert "Entering Rectangle (100–110)" in notify.telegram_text(f) and "Entering Rectangle" in notify.push_text(f)


# --- API ---------------------------------------------------------------------------------------------------------------------------------------------

def client():
    return TestClient(app, headers=ORIGIN)


def login(c, email="a@example.com"):
    r = c.post("/auth/register", json={"email": email, "password": PW})
    assert r.status_code == 201
    return r.json()["user"]["id"]


BODY = {"symbol": SYM, "cond": "cross", "level": 105.0, "trigger": "once", "tf": "M5", "channels": {"web": True}, "drawing": spec()}


def test_create_drawing_alert_stores_a_copy_and_asks_for_candles():
    c = client()
    login(c)
    r = c.post("/alerts", json=BODY)
    assert r.status_code == 201
    a = r.json()
    assert a["drawing"]["type"] == "trendline" and a["drawing"]["pts"] == [[0, 100.0], [600, 110.0]] and a["drawing"]["id"] == "d1"
    assert (SYM, "M5") in alerts.engine.bar_pairs() and "M5" in state.aggregator.tfs[SYM]
    assert any(cmd["symbol"] == SYM and cmd["tf"] == "M5" for cmd in state.pending_backfill)  # nến đủ để đếm chỉ số nến
    assert c.get("/alerts").json()[0]["drawing"]["label"] == "Trend Line"


def test_conditions_must_fit_the_shape():
    c = client()
    login(c)
    post = lambda **kw: c.post("/alerts", json={**BODY, **kw}).status_code
    assert post(cond="enter") == 422  # đường không có "vào / ra"
    rect = spec("rect", [(0, 110.0), (600, 100.0)])
    assert post(cond="enter", drawing=rect) == 201 and post(cond="cross_up", drawing=rect) == 422 and post(cond="gt", drawing=rect) == 422
    assert post(cond="enter", drawing=None) == 422  # alert theo mức giá cố định cũng không có "vào / ra"
    assert post(drawing={"type": "fib", "pts": [[0, 1], [1, 2]]}) == 422 and post(drawing={**spec(), "pts": [[0, 100.0]]}) == 422


def test_patch_replaces_the_copy_unlinks_and_guards_the_type():
    c = client()
    login(c)
    a = c.post("/alerts", json=BODY).json()
    moved = spec(pts=((0, 101.0), (600, 111.0)))
    r = c.patch(f"/alerts/{a['id']}", json={"drawing": moved})
    assert r.status_code == 200 and r.json()["drawing"]["pts"] == [[0, 101.0], [600, 111.0]]
    assert c.patch(f"/alerts/{a['id']}", json={"drawing": spec("rect", [(0, 1.0), (60, 2.0)])}).status_code == 422  # đổi loại hình
    assert c.patch(f"/alerts/{a['id']}", json={"cond": "enter"}).status_code == 422
    r = c.patch(f"/alerts/{a['id']}", json={"unlink": True})
    assert r.json()["drawing"]["id"] is None and r.json()["drawing"]["pts"] == [[0, 101.0], [600, 111.0]] and r.json()["state"] == "active"
    plain = c.post("/alerts", json={**BODY, "drawing": None}).json()
    assert c.patch(f"/alerts/{plain['id']}", json={"drawing": spec()}).status_code == 422  # alert theo mức giá không gắn hình


def test_other_users_cannot_touch_a_drawing_alert():
    a_c, b_c = client(), client()
    login(a_c, "a@example.com")
    login(b_c, "b@example.com")
    aid = a_c.post("/alerts", json=BODY).json()["id"]
    assert b_c.patch(f"/alerts/{aid}", json={"drawing": spec(pts=((0, 1.0), (60, 2.0)))}).status_code == 404 and b_c.get("/alerts").json() == []


def test_old_database_gets_the_new_columns():
    cols = {r[1] for r in state.meta.db.execute("PRAGMA table_info(alerts)")}
    logcols = {r[1] for r in state.meta.db.execute("PRAGMA table_info(alert_log)")}
    assert "drawing" in cols and "label" in logcols


# --- cả vòng với nến thật trong DB ------------------------------------------------------------------------------------------------------------------------

def test_ticks_fire_a_trendline_alert_across_a_weekend_gap():
    """20 nến M1, giữa chừng nghỉ ~17 giờ (cuối tuần). Hai điểm neo ở nến 0 (100) và nến 15 (115): nến đang chạy là nến 20 nên đường ở 120. Nội suy theo thời gian
    thuần sẽ cho giá khác hẳn (đường gần như nằm ngang vì khoảng nghỉ chiếm gần hết thời gian)."""
    sym = "WEEKENDm"
    state.symbols[sym] = {"name": sym}
    now_bar = bar_open(int(time.time()), "M1", 0)
    # nến 0..9 cách xa nến 10..19 (khoảng nghỉ như cuối tuần); nến 19 là nến phút trước, nên nến đang chạy (chưa có trong DB) là nến 20
    times = [now_bar - 1000 * STEP + i * STEP for i in range(10)] + [now_bar - 10 * STEP + i * STEP for i in range(10)]
    seed_bars(sym, "M1", times)
    c = client()
    try:
        login(c)
        body = {**BODY, "symbol": sym, "tf": "M1", "cond": "cross_up", "drawing": spec(pts=((times[0], 100.0), (times[15], 115.0)), ext="right")}
        assert c.post("/alerts", json=body).status_code == 201
        now_ms = int(time.time() * 1000)
        for i, bid in enumerate((118.0, 119.5, 120.5)):
            tcp_server._handle_ticks(TicksIn(symbol=sym, ticks=[{"t_msc": now_ms + i, "bid": bid, "ask": bid + 0.1, "last": 0, "vol": 0}]))
        f = alerts.dispatcher._q.get_nowait()
        assert f.price == 120.5 and f.alert["now"] == [120.0, 120.0]  # 1 giá mỗi nến (100 -> 115 qua 15 nến) nên nến 20 là 120
        assert alerts.dispatcher._q.empty()
    finally:
        drop_bars(sym, "M1")
        state.symbols.pop(sym, None)
