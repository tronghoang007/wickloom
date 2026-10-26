"""Alert theo indicator: engine (alerts.Engine.eval_indicators), API và nội dung thông báo."""
import math
import random

import pytest
from fastapi.testclient import TestClient

from app import accounts, alerts, auth, indicators, notify, state
from app.alerts import Alert, Engine
from app.main import app
from app.notify import Fired

SYM = "XAUUSDm"
TF = "M5"
STEP = 300
T = 1_800_000_000  # chia hết cho 300
ORIGIN = {"Origin": "http://localhost:3000"}

# "sma" độ dài 1 chính là giá đóng cửa: cho phép dựng điều kiện bằng đúng các con số của giá
CLOSE = {"id": "sma", "plot": "sma", "vs": "level", "inputs": {"length": 1}}


@pytest.fixture(autouse=True)
def clean():
    with state.meta.tx() as db:
        for t in ("alerts", "alert_log", "notify_channels", "sessions", "users"):
            db.execute(f"DELETE FROM {t}")
    alerts.engine._by_symbol.clear()
    state.symbols[SYM] = {"name": SYM}
    real = accounts.PBKDF2_ITER
    accounts.PBKDF2_ITER = 1_000
    yield
    accounts.PBKDF2_ITER = real
    state.symbols.pop(SYM, None)
    alerts.engine._by_symbol.clear()


def mk(spec=None, cond="cross_up", level=100.0, trigger="once_per_bar_close", **kw) -> Alert:
    return Alert(id=kw.pop("id", "i1"), user_id="u1", symbol=SYM, cond=cond, level=level, trigger=trigger, tf=TF, expires_at=None, name="", message="",
                 channels={"web": True, "telegram": False, "mt5": False}, state="active", created_at=T, checked_at=kw.pop("checked_at", None),
                 indicator=indicators.clean_spec(spec or CLOSE), **kw)


def bar(i, c, o=None, h=None, l=None):
    return {"t": T + i * STEP, "o": c if o is None else o, "h": c if h is None else h, "l": c if l is None else l, "c": c, "v": 1}


class Rig:
    """Engine với đồng hồ, nến và tick giả. `closes[i]` là giá đóng của nến i (mở lúc T + i·300)."""

    def __init__(self, alert, closes):
        self.data = [bar(i, c) for i, c in enumerate(closes)]
        self.forming = None
        self.now = float(T + len(closes) * STEP)  # đúng lúc nến cuối vừa đóng
        self.out, self.saved = [], []
        if alert.checked_at is None:  # alert vừa được tạo lúc nến cuối đóng: không soát ngược về trước
            alert.checked_at = int(self.now)
        self.engine = Engine(self.out.append, lambda a: self.saved.append((a.id, a.state)), lambda: self.now, history=lambda sym, tf, n: self.data[-n:], live=lambda sym, tf: self.forming)
        self.engine.load([alert])
        self.alert = alert

    def add(self, *closes):
        """Thêm nến đã đóng và đẩy đồng hồ tới sau nến cuối."""
        for c in closes:
            self.data.append(bar(len(self.data), c))
        self.now = float(T + len(self.data) * STEP)

    def tick(self, price, dt=1.0):
        self.now += dt
        self.engine.on_price(SYM, int(self.now * 1000), price, 0)

    def run(self):
        self.engine.eval_indicators()
        return self.out


# --- "đóng nến" --------------------------------------------------------------------------------------------------------------------------------------------

def test_the_first_evaluation_only_sets_the_reference():
    r = Rig(mk(cond="cross_up"), [95, 96, 97, 105])  # nến cuối đã vượt mức lúc alert được tạo
    assert r.run() == []
    r.add(106)
    assert r.run() == []  # vẫn ở trên, không phải một lần cắt mới


def test_a_new_closed_bar_that_crosses_fires_once():
    r = Rig(mk(cond="cross_up"), [95, 96, 97])
    assert r.run() == []
    r.add(101)
    [f] = r.run()
    assert f.price == 101 and not f.late and f.alert["fire_count"] == 1
    assert f.alert["now"] == [101, 100.0] and f.alert["indicator"]["vs"] == "level"
    assert r.saved == [("i1", "active")]  # "đóng nến" nổ mỗi nến một lần, không tự dừng


def test_it_does_not_evaluate_the_same_bar_twice_and_keeps_running():
    r = Rig(mk(cond="cross"), [95, 96])
    r.add(101)
    r.run()
    r.run()
    assert len(r.out) == 1  # chạy lại trên cùng một nến thì không nổ lại
    r.add(99)
    r.run()
    assert len(r.out) == 2 and r.engine.symbols() == {SYM}  # cắt xuống ở nến kế; alert vẫn chạy


def test_the_bar_still_running_is_not_a_closed_bar():
    r = Rig(mk(cond="cross_up"), [95, 96, 97])
    r.data.append(bar(3, 110))  # nến thứ 3 còn đang chạy (chưa tới T + 4·300)
    assert r.run() == []
    r.now += STEP  # nến 3 đóng
    [f] = r.run()
    assert f.price == 110


def test_bars_that_closed_while_the_backend_was_off_are_checked_late_in_order():
    # alert được đánh giá lần cuối ở nến 2; backend tắt qua nến 3..6; cắt lên ở nến 4 rồi giá về lại dưới mức
    a = mk(cond="cross_up", checked_at=T + 3 * STEP)
    r = Rig(a, [95, 96, 97, 98, 101, 99, 98])
    [f] = r.run()
    assert f.late and f.price == 101 and f.time == T + 5 * STEP  # giờ nến đóng, không phải bây giờ
    assert f.alert["fire_count"] == 1


def test_bars_before_the_last_evaluation_are_left_alone():
    a = mk(cond="cross_up", checked_at=T + 6 * STEP)  # đã đánh giá tới nến 5
    r = Rig(a, [95, 101, 96, 97, 98, 99, 100.5])
    assert [f.price for f in r.run()] == [100.5] and not r.out[0].late  # cắt lên ở nến 1 đã qua, không tính; nến 6 đóng ở 100.5 cắt lên mức 100


def test_gt_fires_at_the_first_new_close_that_satisfies_it():
    r = Rig(mk(cond="gt"), [95, 96, 120])
    assert r.run() == []  # nến đóng lúc tạo chỉ là mốc, kể cả đã thoả
    r.add(99)
    assert r.run() == []
    r.add(103)
    assert [f.price for f in r.run()] == [103]


def test_not_enough_bars_or_not_enough_history_for_the_indicator_means_no_alert():
    r = Rig(mk(cond="cross_up"), [101])
    assert r.run() == []
    spec = {"id": "rsi", "plot": "rsi", "vs": "level", "inputs": {"length": 14}}
    r = Rig(mk(spec, cond="gt", level=0.0), [100, 101, 102, 103])  # RSI(14) cần 15 nến: toàn NaN
    r.add(104)
    assert r.run() == []


def test_macd_against_signal_matches_a_brute_force_scan():
    rnd = random.Random(7)
    closes, p = [], 2000.0
    for _ in range(260):
        p += rnd.uniform(-3, 3)
        closes.append(p)
    spec = {"id": "macd", "plot": "macd", "vs": "signal"}
    sp = indicators.clean_spec(spec)
    line, other = indicators.compute(sp, [bar(i, c) for i, c in enumerate(closes)])
    d = [x - y for x, y in zip(line, other)]
    ups = [i for i in range(201, 260) if d[i - 1] < 0 <= d[i]]
    assert ups, "dữ liệu thử phải có ít nhất một lần cắt lên"
    a = mk(spec, cond="cross_up", checked_at=T + 200 * STEP)  # đã xét tới nến 199
    r = Rig(a, closes)
    [f] = r.run()
    assert f.late and f.time == T + (ups[0] + 1) * STEP and f.price == closes[ups[0]]


# --- theo giá hiện tại ----------------------------------------------------------------------------------------------------------------------------------

def test_live_evaluation_waits_for_a_tick_and_the_first_one_is_the_reference():
    a = mk(cond="cross_up", trigger="once")
    r = Rig(a, [95, 96, 97])
    assert r.run() == []  # chưa có tick
    r.tick(105)
    assert r.run() == []  # giá đã ở trên mức: mốc
    r.tick(99)
    assert r.run() == []
    r.tick(100.5)
    [f] = r.run()
    assert f.price == 100.5 and f.alert["now"] == [100.5, 100.0]


def test_live_gt_fires_at_once_when_already_true():
    r = Rig(mk(cond="gt", trigger="once"), [95, 96, 97])
    r.tick(101)
    assert [f.price for f in r.run()] == [101]


def test_live_once_per_bar_fires_once_in_each_bar():
    a = mk(cond="cross", trigger="once_per_bar")
    r = Rig(a, [95, 96, 97])
    r.tick(99)
    r.run()
    r.tick(101)
    r.run()
    r.tick(99)
    r.run()
    r.tick(101)
    r.run()
    assert len(r.out) == 1  # cùng nến: chỉ một lần
    r.add(97)  # nến mới
    r.tick(99)
    r.run()
    r.tick(101)
    r.run()
    assert len(r.out) == 2


def test_live_every_time_is_throttled_and_skips_evaluation_when_nothing_changed():
    r = Rig(mk(cond="cross", trigger="every_time"), [95, 96, 97])
    r.tick(99)
    r.run()
    r.tick(101, dt=0.5)
    r.run()
    r.run()  # giá và nến chưa đổi: không tính lại, không nổ lại
    assert len(r.out) == 1
    r.tick(99, dt=1)
    r.run()
    assert len(r.out) == 1  # chưa đủ REFIRE_GAP
    r.tick(101, dt=alerts.REFIRE_GAP)
    r.run()
    assert len(r.out) == 2


def test_live_does_not_recompute_while_price_and_bars_are_unchanged(monkeypatch):
    calls = []
    real = indicators.compute
    monkeypatch.setattr(indicators, "compute", lambda *a: (calls.append(1), real(*a))[1])
    r = Rig(mk(cond="cross", trigger="once"), [95, 96, 97])
    r.tick(99)
    r.run()
    r.run()
    r.run()
    assert len(calls) == 1
    r.tick(98)
    r.run()
    assert len(calls) == 2


def test_live_uses_the_forming_bar_of_the_aggregator_when_there_is_one():
    spec = {"id": "stoch", "plot": "k", "vs": "level", "inputs": {"k": 3, "smooth": 1, "d": 1}}
    a = mk(spec, cond="gt", level=90.0, trigger="once")
    r = Rig(a, [100, 101, 102, 101, 100, 101])
    r.forming = {"t": T + 6 * STEP, "o": 101, "h": 130, "l": 101, "c": 101, "v": 5}  # nến đang chạy đã lên tới 130
    r.tick(129)
    [f] = r.run()
    k_with_high = f.alert["now"][0]
    r2 = Rig(mk(spec, cond="gt", level=90.0, trigger="once"), [100, 101, 102, 101, 100, 101])
    r2.tick(129)  # không có nến đang chạy: dựng từ giá (đỉnh = giá)
    [g] = r2.run()
    assert math.isclose(g.alert["now"][0], 100 * (129 - 100) / (129 - 100), rel_tol=1e-9) and k_with_high == pytest.approx(100 * (129 - 100) / (130 - 100), rel=1e-9)


def test_live_ignores_a_stale_forming_bar():
    r = Rig(mk(cond="cross_up", trigger="once"), [95, 96, 97])
    r.forming = {"t": T + 2 * STEP, "o": 1, "h": 1000, "l": 1, "c": 1, "v": 1}  # đã là nến đóng rồi
    r.tick(99)
    r.run()
    r.tick(100.5)
    [f] = r.run()
    assert f.price == 100.5


def test_live_other_series_vs_price():
    spec = {"id": "sma", "plot": "sma", "vs": "price", "inputs": {"length": 3}}
    a = mk(spec, cond="cross_up", trigger="every_time")  # SMA(3) cắt lên giá = giá cắt xuống SMA
    r = Rig(a, [100, 101, 102, 103, 104])
    r.tick(110)  # giá cao hơn hẳn SMA
    r.run()
    r.tick(95, dt=10)  # giá rơi dưới SMA
    [f] = r.run()
    assert f.alert["now"][0] > 95 and f.alert["now"][1] == 95  # (SMA, giá)


# --- không chạm vào luồng khác ---------------------------------------------------------------------------------------------------------------------------

def test_the_tick_path_and_the_bar_close_hook_leave_indicator_alerts_alone():
    a = mk(cond="gt", trigger="once")
    r = Rig(a, [95, 96, 97])
    r.engine.on_price(SYM, int((r.now + 1) * 1000), 150.0, 0)
    r.engine.on_bar_close(SYM, TF, {"t": T, "o": 1, "h": 1, "l": 1, "c": 150.0, "v": 1})
    assert r.out == [] and a.state == "active"  # chỉ eval_indicators mới được nổ


def test_indicator_alerts_never_ask_for_the_m1_catch_up():
    a = mk(cond="cross_up")
    r = Rig(a, [95, 96, 97])
    requests = []
    r.engine.request = requests.append
    r.engine.on_price(SYM, int((r.now + 10_000) * 1000), 99.0, 0)
    assert requests == [] and a.catch is None


def test_history_needs_and_bar_pairs_cover_indicator_alerts():
    a = mk({"id": "ema", "plot": "ema", "vs": "price", "inputs": {"length": 200}})
    r = Rig(a, [95, 96, 97])
    assert r.engine.history_needs() == {(SYM, TF): 900} and r.engine.bar_pairs() == {(SYM, TF)}
    assert state.aggregator.tfs[SYM] >= {TF}  # alert yêu cầu aggregator dựng nến của khung này dù không chart nào mở


# --- nội dung thông báo ----------------------------------------------------------------------------------------------------------------------------------

def fired_for(spec, cond, level, now=None, late=False):
    a = mk(spec, cond=cond, level=level)
    snap = a.public(with_user=True)
    if now:
        snap["now"] = list(now)
    return Fired(snap, 4001.5, T, late=late)


def test_condition_text_for_the_three_kinds_of_comparison():
    rsi = {"id": "rsi", "plot": "rsi", "vs": "level", "label": "RSI 14 close"}
    assert notify.condition_text(fired_for(rsi, "cross_up", 70.0).alert) == "XAUUSDm RSI 14 close Crossing Up 70"
    assert notify.condition_text(fired_for(rsi, "cross_up", 70.0, now=(70.4, 70.0)).alert) == "XAUUSDm RSI 14 close Crossing Up 70 (70.4)"
    macd = {"id": "macd", "plot": "macd", "vs": "signal", "label": "MACD 12 26 9"}
    assert notify.condition_text(fired_for(macd, "cross", 0.0).alert) == "XAUUSDm MACD 12 26 9 Crossing Signal"
    ema = {"id": "ema", "plot": "ema", "vs": "price", "label": "EMA 50 close"}
    assert notify.condition_text(fired_for(ema, "lt", 0.0).alert) == "XAUUSDm EMA 50 close Less Than price"


def test_the_indicator_value_is_short():
    assert [notify.fmt_value(v) for v in (82.66572505, 70.0, 4012.3456789, -0.00001, 0.5, -3.25)] == ["82.6657", "70", "4012.3457", "0", "0.5", "-3.25"]


def test_every_channel_gets_the_same_sentence_and_late_is_marked():
    f = fired_for({"id": "rsi", "plot": "rsi", "vs": "level", "label": "RSI"}, "gt", 70.0, now=(71.2, 70.0), late=True)
    assert notify.fired_line(f) == "(trễ) XAUUSDm RSI Greater Than 70 (71.2) · giá 4001.5"
    assert "XAUUSDm RSI Greater Than 70 (71.2)" in notify.telegram_text(f)
    assert notify.push_text(f) == "(trễ) XAUUSDm RSI Greater Than 70 (71.2) @ 4001.5"


def test_the_log_keeps_the_condition_text_of_an_indicator_alert():
    f = fired_for({"id": "rsi", "plot": "rsi", "vs": "level", "label": "RSI"}, "gt", 70.0, now=(71.2, 70.0))
    alerts.log_add(f)
    [row] = alerts.log_list("u1", 5)
    assert row["kind"] == "price" and row["text"] == "XAUUSDm RSI Greater Than 70 (71.2)"
    alerts.log_add(Fired(mk(cond="gt").public(with_user=True) | {"indicator": None}, 1.0, T))
    assert alerts.log_list("u1", 5)[0]["text"] == ""  # alert giá thường: không có `text`


# --- API --------------------------------------------------------------------------------------------------------------------------------------------------

def client():
    return TestClient(app, headers=ORIGIN)


def login(c, email="a@example.com"):
    r = c.post("/auth/register", json={"email": email, "password": "correct horse"})
    assert r.status_code == 201
    return r.json()["user"]["id"]


BODY = {"symbol": SYM, "cond": "cross_up", "level": 70.0, "trigger": "once_per_bar_close", "tf": "M15", "channels": {"web": True},
        "indicator": {"id": "rsi", "plot": "rsi", "vs": "level", "label": "RSI 14 close", "inputs": {"length": 14}}}


def test_create_stores_the_cleaned_spec_and_asks_for_enough_history(monkeypatch):
    asked = []
    monkeypatch.setattr(state, "ensure_history", lambda *a: asked.append(a))
    c = client()
    uid = login(c)
    r = c.post("/alerts", json=BODY)
    assert r.status_code == 201
    ind = r.json()["indicator"]
    assert ind["inputs"]["length"] == 14 and ind["inputs"]["src"] == "close" and ind["vs_label"] == "" and ind["label"] == "RSI 14 close"
    assert asked == [(SYM, "M15", indicators.history_need(ind))]
    assert alerts.db_get(uid, r.json()["id"]).indicator == ind  # ghi / đọc DB nguyên vẹn
    assert alerts.engine.symbols() == {SYM}
    assert state.aggregator.tfs[SYM] >= {"M15"}


@pytest.mark.parametrize("patch,why", [
    ({"indicator": {"id": "nope", "plot": "x", "vs": "level"}}, "chưa tạo alert được"),
    ({"indicator": {"id": "rsi", "plot": "nope", "vs": "level"}}, "Chọn đường"),
    ({"indicator": {"id": "rsi", "plot": "rsi", "vs": "rsi"}}, "so sánh"),
    ({"cond": "enter"}, "Điều kiện"),
    ({"tf": "MN1"}, "Khung"),
    ({"drawing": {"id": "d", "layout": "L", "type": "trendline", "label": "T", "pts": [[1, 1.0], [2, 2.0]], "ext": "right", "log": False}}, "không cả hai"),
])
def test_create_rejects_bad_requests(patch, why):
    c = client()
    login(c)
    r = c.post("/alerts", json={**BODY, **patch})
    assert r.status_code == 422 and why in r.json()["detail"]
    assert c.get("/alerts").json() == []


def test_patch_can_change_the_line_but_not_the_indicator(monkeypatch):
    monkeypatch.setattr(state, "ensure_history", lambda *a: None)
    c = client()
    login(c)
    aid = c.post("/alerts", json=BODY).json()["id"]
    got = c.patch(f"/alerts/{aid}", json={"indicator": {"id": "rsi", "plot": "sm", "vs": "price", "inputs": {"length": 7}}})
    assert got.status_code == 200 and got.json()["indicator"]["plot"] == "sm" and got.json()["indicator"]["inputs"]["length"] == 7
    assert c.patch(f"/alerts/{aid}", json={"indicator": {"id": "macd", "plot": "macd", "vs": "signal"}}).status_code == 422
    plain = c.post("/alerts", json={"symbol": SYM, "cond": "cross", "level": 4000.0, "channels": {"web": True}}).json()["id"]
    assert c.patch(f"/alerts/{plain}", json={"indicator": BODY["indicator"]}).status_code == 422  # alert giá không đổi thành alert indicator


def test_indicator_alerts_survive_a_restart():
    c = client()
    login(c)
    aid = c.post("/alerts", json=BODY).json()["id"]
    alerts.engine._by_symbol.clear()
    alerts.engine.load(alerts.db_active())
    [a] = alerts.engine._by_symbol[SYM]
    assert a.id == aid and a.indicator is not None and a.ind_since == a.checked_at


def test_old_alert_rows_without_the_column_still_load():
    # DB đã có từ trước Phase 3: cột `indicator` được thêm lúc khởi động (ALTER); dòng cũ có indicator = NULL
    c = client()
    uid = login(c)
    c.post("/alerts", json={"symbol": SYM, "cond": "cross", "level": 4000.0, "channels": {"web": True}})
    with state.meta.tx() as db:
        db.execute("UPDATE alerts SET indicator=NULL, checked_at=NULL")
    [a] = alerts.db_list(uid)
    assert a.indicator is None and a.checked_at is None
