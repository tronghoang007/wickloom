"""Báo bù lần giá chạm lúc backend / EA tắt (alerts.Engine: _note_tick, _catch_up, run_catchups, flush)."""
import pytest
from fastapi.testclient import TestClient

from app import accounts, alerts, auth, state, tcp_server
from app.alerts import CATCHUP_GAP, CATCHUP_SETTLE, CATCHUP_WAIT, Alert, Engine, touch
from app.main import app
from app.models import BarsIn

SYM = "XAUUSDm"
T = 1_800_000_000  # đầu một phút
ORIGIN = {"Origin": "http://localhost:3000"}


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


def mk(cond="cross_up", level=100.0, trigger="once", **kw) -> Alert:
    return Alert(id=kw.pop("id", "a1"), user_id="u1", symbol=SYM, cond=cond, level=level, trigger=trigger, tf=kw.pop("tf", "M1"), expires_at=kw.pop("expires_at", None), name="", message="",
                 channels={"web": True, "telegram": False, "mt5": False}, state="active", created_at=T, checked_at=kw.pop("checked_at", T), **kw)


def bar(t, o, h, l, c):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": 1}


class Rig:
    def __init__(self, *alist: Alert, bars=()):
        self.now = float(T)
        self.fired, self.requests, self.checkpoints, self.data = [], [], [], list(bars)
        self.engine = Engine(self.fired.append, lambda a: None, lambda: self.now, bars=lambda sym, lo, hi: [b for b in self.data if lo <= b["t"] < hi], request=self.requests.append,
                             checkpoint=self.checkpoints.append)
        self.engine.load(alist)

    def tick(self, price, at):
        self.now = float(at)
        self.engine.on_price(SYM, int(at * 1000), price, 0)

    def settle(self, dt=CATCHUP_SETTLE + 1):
        """EA đã đổ nến M1 về, rồi lặng `dt` giây."""
        self.engine.on_bars(SYM)
        self.now += dt
        self.engine.run_catchups()


# --- touch ------------------------------------------------------------------------------------------------------------------------------------------------

def test_touch_truth_table():
    b = bar(0, 99, 101, 98, 100)
    assert touch("cross_up", 100, 99, b) and touch("cross_up", 101, 99, b) and not touch("cross_up", 102, 99, b)
    assert not touch("cross_up", 100, 101, b)  # đang ở trên mức rồi: chưa cắt lên
    assert touch("cross_down", 98.5, 99, b) and not touch("cross_down", 97, 99, b) and not touch("cross_down", 100, 99, b)
    assert touch("cross", 100, 99, b) and touch("cross", 98.5, 99, b) and not touch("cross", 105, 99, b)
    assert touch("gt", 100.5, 105, b) and not touch("gt", 101, 105, b)  # gt / lt chỉ cần nến vượt mức, không cần mốc
    assert touch("lt", 98.5, 99, b) and not touch("lt", 98, 99, b)
    assert touch("cross_up", 100, None, b)  # chưa có giá đóng trước: lấy giá mở của nến làm mốc


# --- phát hiện khoảng đứt ---------------------------------------------------------------------------------------------------------------------------------

def test_a_gap_requests_the_m1_bars_once():
    r = Rig(mk())
    r.tick(99, T + 30)
    assert r.requests == [] and r.engine._by_symbol[SYM][0].catch is None  # tick bình thường
    r.tick(99, T + 30 + CATCHUP_GAP + 1)
    assert r.requests == [SYM]
    r.tick(99, T + 30 + CATCHUP_GAP + 2)
    assert r.requests == [SYM]  # một khoảng đứt chỉ xin một lần
    r.tick(99, T + 3 * CATCHUP_GAP + 100)
    assert r.requests == [SYM]  # đang chờ khoảng đứt trước: chưa xin thêm
    r.now += CATCHUP_WAIT + 1
    r.engine.run_catchups()
    r.tick(99, r.now + 3 * CATCHUP_GAP)
    assert r.requests == [SYM, SYM]  # khoảng đứt trước đã xong: khoảng đứt kế tiếp thì xin tiếp


def test_a_short_gap_is_not_a_gap():
    r = Rig(mk())
    r.tick(99, T + CATCHUP_GAP)
    assert r.requests == []


def test_alerts_that_cannot_catch_up_never_request_bars():
    drawing = {"id": "d", "layout": "L", "type": "trendline", "label": "Trendline", "pts": [[T, 1.0], [T + 60, 2.0]], "ext": "right", "log": False}
    r = Rig(mk(id="d1", drawing=drawing), mk(id="c1", trigger="once_per_bar_close"))
    r.tick(99, T + 3600)
    assert r.requests == []


def test_an_old_alert_without_a_checkpoint_never_catches_up():
    r = Rig(mk(checked_at=None))
    r.tick(99, T + 3600)
    assert r.requests == [] and r.engine._by_symbol[SYM][0].checked_at == T + 3600  # tick đầu chỉ làm mốc


# --- soát nến ---------------------------------------------------------------------------------------------------------------------------------------------

def gap_bars(*mid):
    """Nến M1 quanh một khoảng đứt từ T + 30 tới T + 900: nến của lần đánh giá cuối (T), các nến `mid`, nến chứa tick đầu sau khoảng đứt (T + 900)."""
    return [bar(T, 99, 99.5, 98.5, 99), *mid, bar(T + 900, 99, 120, 90, 99)]


def test_a_touch_during_the_gap_fires_late_with_the_bar_time_and_the_level():
    r = Rig(mk("cross_up", 100), bars=gap_bars(bar(T + 120, 99, 101, 98.8, 100.5)))
    r.tick(99, T + 30)
    r.tick(99, T + 905)
    r.settle()
    [f] = r.fired
    assert f.late and f.price == 100 and f.time == T + 120 and f.alert["state"] == "triggered" and f.alert["fire_count"] == 1
    assert r.engine.symbols() == set()  # "once": đã nổ thì rời engine
    r.settle()
    assert len(r.fired) == 1


def test_no_touch_means_no_alert_and_the_gap_is_forgotten():
    r = Rig(mk("cross_up", 100), bars=gap_bars(bar(T + 120, 99, 99.9, 98.8, 99.5)))
    r.tick(99, T + 30)
    r.tick(99, T + 905)
    r.settle()
    assert r.fired == [] and r.engine._by_symbol[SYM][0].catch is None


def test_the_first_bar_is_only_a_reference_and_the_bar_of_the_first_live_tick_is_left_to_live_evaluation():
    # nến T và nến T + 900 đều có đỉnh 120 (chạm mức 100) nhưng không được tính: nến đầu đã đánh giá trực tiếp, nến cuối do các tick sau đó lo
    r = Rig(mk("cross_up", 100), bars=[bar(T, 99, 120, 98, 99), bar(T + 120, 99, 99.5, 98, 99), bar(T + 900, 99, 120, 90, 99)])
    r.tick(99, T + 30)
    r.tick(99, T + 905)
    r.settle()
    assert r.fired == []


def test_cross_up_needs_the_price_to_come_from_below():
    r = Rig(mk("cross_up", 100), bars=[bar(T, 105, 106, 104, 105), bar(T + 60, 105, 108, 103, 106), bar(T + 900, 106, 106, 105, 106)])
    r.tick(105, T + 30)
    r.tick(105, T + 905)
    r.settle()
    assert r.fired == []  # nằm trên mức suốt khoảng đứt (dù đỉnh nến cao hơn mức): không phải cắt lên


def test_a_gap_up_over_the_level_is_a_cross_up():
    r = Rig(mk("cross_up", 100), bars=gap_bars(bar(T + 60, 101, 103, 100.5, 102)))
    r.tick(99, T + 30)
    r.tick(99, T + 905)
    r.settle()
    [f] = r.fired
    assert f.time == T + 60 and f.late


@pytest.mark.parametrize("cond,level,mid,fires", [
    ("cross_down", 98.8, bar(T + 60, 99, 99.2, 98.5, 98.9), True),
    ("cross_down", 98.8, bar(T + 60, 99, 99.2, 98.9, 99.1), False),
    ("cross", 98.8, bar(T + 60, 99, 99.2, 98.5, 98.9), True),
    ("cross", 101, bar(T + 60, 99, 102, 98.9, 101.5), True),
    ("gt", 100, bar(T + 60, 99, 100.5, 98.9, 99), True),
    ("gt", 100, bar(T + 60, 99, 100, 98.9, 99), False),
    ("lt", 98.9, bar(T + 60, 99, 99.2, 98.5, 99), True),
    ("lt", 98.9, bar(T + 60, 99, 99.2, 98.9, 99), False),
])
def test_conditions_during_the_gap(cond, level, mid, fires):
    r = Rig(mk(cond, level), bars=gap_bars(mid))
    r.tick(99, T + 30)
    r.tick(99, T + 905)
    r.settle()
    assert bool(r.fired) is fires


def test_only_one_late_alert_per_gap_even_for_every_time_and_the_alert_keeps_running():
    r = Rig(mk("cross", 100, "every_time"), bars=gap_bars(bar(T + 60, 99, 101, 98.9, 100.5), bar(T + 120, 100.5, 101, 98.9, 99)))
    r.tick(99, T + 30)
    r.tick(99, T + 905)
    r.settle()
    assert len(r.fired) == 1 and r.fired[0].time == T + 60 and r.engine.symbols() == {SYM}


def test_an_alert_that_already_fired_live_after_the_gap_started_is_not_repeated():
    r = Rig(mk("cross", 100, "every_time"), bars=gap_bars(bar(T + 60, 99, 101, 98.9, 100.5)))
    r.tick(99, T + 30)
    r.tick(99, T + 905)
    r.tick(101, T + 906)  # tick trực tiếp đầu tiên cắt luôn mức: đã nổ rồi
    assert len(r.fired) == 1 and not r.fired[0].late
    r.settle()
    assert len(r.fired) == 1


def test_bars_after_the_expiry_do_not_count():
    r = Rig(mk("cross_up", 100, expires_at=T + 100), bars=gap_bars(bar(T + 60, 99, 99.5, 98.9, 99), bar(T + 120, 99, 101, 98.9, 100.5)))
    r.tick(99, T + 30)
    r.tick(99, T + 905)
    r.settle()
    assert r.fired == []


def test_a_paused_or_finished_alert_does_not_fire_late():
    a = mk("cross_up", 100)
    r = Rig(a, bars=gap_bars(bar(T + 60, 99, 101, 98.9, 100.5)))
    r.tick(99, T + 30)
    r.tick(99, T + 905)
    a.state = "paused"
    r.settle()
    assert r.fired == []


# --- chờ EA nạp nến ---------------------------------------------------------------------------------------------------------------------------------------

def test_waits_until_the_bars_stop_arriving():
    r = Rig(mk("cross_up", 100), bars=gap_bars(bar(T + 60, 99, 101, 98.9, 100.5)))
    r.tick(99, T + 30)
    r.tick(99, T + 905)
    r.engine.run_catchups()
    assert r.fired == []  # EA chưa gửi gì
    r.engine.on_bars(SYM)
    r.now += CATCHUP_SETTLE - 1
    r.engine.run_catchups()
    assert r.fired == []  # nến vừa tới: có thể còn đợt nữa
    r.now += 2
    r.engine.run_catchups()
    assert len(r.fired) == 1


def test_bars_that_arrived_before_the_gap_was_noticed_do_not_count_as_the_answer():
    r = Rig(mk("cross_up", 100), bars=gap_bars(bar(T + 60, 99, 101, 98.9, 100.5)))
    r.tick(99, T + 30)
    r.engine.on_bars(SYM)  # nến M1 do chart nạp, trước khi phát hiện khoảng đứt
    r.now += 10
    r.tick(99, T + 905)
    r.now += CATCHUP_SETTLE + 1
    r.engine.run_catchups()
    assert r.fired == []


def test_gives_up_waiting_and_scans_what_is_there():
    r = Rig(mk("cross_up", 100), bars=gap_bars(bar(T + 60, 99, 101, 98.9, 100.5)))
    r.tick(99, T + 30)
    r.tick(99, T + 905)
    r.now += CATCHUP_WAIT - 1
    r.engine.run_catchups()
    assert r.fired == []
    r.now += 2
    r.engine.run_catchups()
    assert len(r.fired) == 1 and r.fired[0].late


def test_no_bars_at_all_just_forgets_the_gap():
    r = Rig(mk("cross_up", 100))
    r.tick(99, T + 30)
    r.tick(99, T + 905)
    r.now += CATCHUP_WAIT + 1
    r.engine.run_catchups()
    assert r.fired == [] and r.engine._by_symbol[SYM][0].catch is None


# --- mốc ghi xuống DB -------------------------------------------------------------------------------------------------------------------------------------

def test_flush_writes_only_the_checkpoints_that_changed():
    r = Rig(mk(id="a"), mk(id="b"))
    r.engine.flush()
    assert r.checkpoints == []  # vừa nạp từ DB: mốc đã có sẵn
    r.tick(99, T + 10)
    r.engine.flush()
    assert sorted(r.checkpoints[0]) == [(T + 10, 99, "a"), (T + 10, 99, "b")]  # mốc kèm giá của tick
    r.engine.flush()
    assert len(r.checkpoints) == 1


def test_checkpoint_survives_in_the_database():
    c = TestClient(app, headers=ORIGIN)
    uid = c.post("/auth/register", json={"email": "a@example.com", "password": "correct horse"}).json()["user"]["id"]
    made = c.post("/alerts", json={"symbol": SYM, "cond": "cross", "level": 4000.0, "channels": {"web": True}}).json()
    row = alerts.db_get(uid, made["id"])
    assert row is not None and row.checked_at is not None  # tạo alert đặt mốc báo bù = lúc tạo
    alerts.db_checkpoint([(100, 4000.5, made["id"])])
    assert alerts.db_get(uid, made["id"]).checked_at == 100
    alerts.engine._by_symbol.clear()
    alerts.engine.load(alerts.db_active())  # backend khởi động lại: mốc đọc lại từ DB
    assert alerts.engine._by_symbol[SYM][0].checked_at == 100 and alerts.engine._by_symbol[SYM][0].ref == 4000.5  # giá đã ghi làm mốc cắt cho tick đầu
    c.patch(f"/alerts/{made['id']}", json={"level": 4001.0})
    assert alerts.db_get(uid, made["id"]).checked_at > 100  # sửa alert đặt lại mốc: không soát ngược về trước lúc sửa


def test_m1_bars_from_the_ea_are_noted_by_the_engine():
    alerts.engine._bars_seen.clear()
    tcp_server._handle_bars(BarsIn(symbol=SYM, tf="H1", bars=[{"t": T, "o": 1, "h": 1, "l": 1, "c": 1}]))
    assert alerts.engine._bars_seen == {}  # khung khác không liên quan
    tcp_server._handle_bars(BarsIn(symbol=SYM, tf="M1", bars=[{"t": T, "o": 1, "h": 1, "l": 1, "c": 1}]))
    assert SYM in alerts.engine._bars_seen
