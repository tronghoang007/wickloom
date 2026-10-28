"""Hồi quy cho các lỗi của alert tìm thấy khi review (2026-10-28): khởi động lại mất lần cắt, bản cũ của alert indicator vẫn nổ sau khi tạm dừng, sửa alert ghi đè lần nổ,
hết hạn trong khoảng đứt bỏ mất báo bù, báo bù chạy khi nến chưa về, Telegram chậm làm trễ web, kênh MT5 chỉ cho chủ máy, giới hạn số alert khi bật lại."""
import dataclasses
import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app import accounts, alerts, indicators, notify, state
from app.alerts import CATCHUP_GAP, CATCHUP_SETTLE, CATCHUP_WAIT, Engine
from app.main import app
from app.notify import Fired

from test_alert_catchup import ORIGIN, SYM, T, Rig, bar, clean, mk  # noqa: F401  (clean: fixture autouse dọn DB / engine)


# --- 1. khởi động lại ngắn không mất lần cắt ---------------------------------------------------------------------------------------------------------------

def test_a_crossing_during_a_short_restart_fires_on_the_first_tick():
    # trước khi tắt: tick cuối 99 (đã ghi checked_price), backend tắt ~40 s (--reload), giá vượt 100 trong lúc đó
    r = Rig(mk(cond="cross_up", level=100.0, checked_at=T + 10, checked_price=99.0))
    r.tick(101, T + 50)
    [f] = r.fired
    assert not f.late and f.price == 101


def test_no_false_cross_after_a_restart_when_the_price_stayed_on_one_side():
    r = Rig(mk(cond="cross_up", level=100.0, checked_at=T + 10, checked_price=101.0))
    r.tick(101.5, T + 50)
    assert r.fired == []


def test_once_per_bar_does_not_refire_in_the_same_bar_after_a_restart():
    a = mk(cond="cross", level=100.0, trigger="once_per_bar", tf="H1", checked_at=T + 10, checked_price=99.0)
    a.fired_at = T + 5  # đã nổ trong nến H1 này trước lúc tắt
    r = Rig(a)
    r.tick(101, T + 50)
    assert r.fired == []


def test_close_alert_after_a_restart_compares_with_the_previous_close_in_the_db():
    hist = [bar(T - 60, 99, 99, 99, 99)]
    r = Rig(mk(cond="cross_up", level=100.0, trigger="once_per_bar_close", checked_at=T + 10, checked_price=99.0))
    r.engine.history = lambda symbol, tf, n: list(hist)
    r.engine.on_bar_close(SYM, "M1", bar(T, 99, 101, 98, 101))
    assert len(r.fired) == 1


def test_live_indicator_alert_after_a_restart_uses_the_saved_price_as_the_previous_value():
    step = 60
    now = T + 400 * step + 5
    rows = [{"t": T + i * step, "o": 100, "h": 100, "l": 100, "c": 100.0, "v": 1} for i in range(400)]
    spec = indicators.clean_spec({"id": "sma", "inputs": {}, "plot": "sma", "vs": "price"})
    fired = []
    eng = Engine(fired.append, lambda a: None, lambda: now, history=lambda s, tf, n: rows[-n:], live=lambda s, tf: None, request=lambda s: None, checkpoint=lambda r: None)
    eng.load([mk(cond="cross", level=0.0, trigger="once", indicator=spec, checked_at=now - 20, checked_price=99.0)])  # trước khi tắt: giá dưới MA
    eng._last[SYM] = (now, 101.0)  # sau khi bật lại: giá đã vượt lên trên MA
    eng.eval_indicators()
    assert len(fired) == 1


# --- 2. bản cũ của alert indicator không nổ sau khi bị tạm dừng / xoá -----------------------------------------------------------------------------------

def _ind_rig(pause: bool):
    step = 60
    rows = [{"t": T + i * step, "o": 100, "h": 100, "l": 100, "c": 100.0, "v": 1} for i in range(400)]
    rows[-2] = {**rows[-2], "c": 99.0, "l": 99}
    rows[-1] = {**rows[-1], "c": 110.0, "h": 110}
    spec = indicators.clean_spec({"id": "sma", "inputs": {}, "plot": "sma", "vs": "price"})
    fired, persisted = [], []
    a = mk(cond="cross", level=0.0, trigger="once_per_bar_close", indicator=spec, checked_at=T + 398 * step + 30)
    holder = {}

    def history(sym, tf, n):
        if pause:  # người dùng tạm dừng alert (thread API) trong lúc thread indicator đang tính
            holder["e"].sync(a.id, dataclasses.replace(a, state="paused"))
        return rows[-n:]

    holder["e"] = Engine(fired.append, persisted.append, lambda: float(T + 400 * step + 1), history=history, request=lambda s: None, checkpoint=lambda r: None)
    holder["e"].load([a])
    holder["e"].eval_indicators()
    return fired, persisted


def test_indicator_alert_paused_while_computing_does_not_fire():
    assert len(_ind_rig(False)[0]) == 1
    assert _ind_rig(True) == ([], [])


# --- 3. sửa alert không ghi đè lần nổ vừa xong ------------------------------------------------------------------------------------------------------------

def test_patch_reads_and_writes_inside_the_engine_lock(monkeypatch):
    c = TestClient(app, headers=ORIGIN)
    c.post("/auth/register", json={"email": "a@example.com", "password": "correct horse"})
    made = c.post("/alerts", json={"symbol": SYM, "cond": "cross", "level": 100.0, "channels": {"web": True}}).json()
    real_get = alerts.db_get
    seen = {}

    def spy(uid, aid):
        seen["locked"] = alerts.engine._lock._is_owned()  # type: ignore[attr-defined]
        return real_get(uid, aid)

    monkeypatch.setattr(alerts, "db_get", spy)
    assert c.patch(f"/alerts/{made['id']}", json={"name": "x"}).status_code == 200
    assert seen["locked"] is True


def test_engine_persists_a_fire_before_releasing_the_lock():
    owned = []
    eng = Engine(lambda f: None, lambda a: owned.append(eng._lock._is_owned()), lambda: float(T))  # type: ignore[attr-defined]
    eng.load([mk(cond="gt", level=100.0)])
    eng.on_price(SYM, (T + 1) * 1000, 101.0, 0)
    assert owned == [True]


# --- 4. hết hạn trong lúc đứt vẫn báo bù phần trước giờ hết hạn ----------------------------------------------------------------------------------------

def test_a_touch_before_the_expiry_is_reported_late_even_if_the_gap_ends_after_it():
    exp = T + 3600
    data = [bar(T + 60 * i, 99, 99.5, 98.9, 99.2) for i in range(30)] + [bar(T + 1800, 99, 101, 99, 100.5), bar(T + 7200, 99, 99, 99, 99)]
    r = Rig(mk(cond="cross_up", level=100.0, checked_at=T, expires_at=exp), bars=data)
    r.tick(99, T + 7200)  # tick đầu sau 2 giờ đứt, đã quá hạn
    r.settle()
    [f] = r.fired
    assert f.late and f.time == T + 1800 and f.alert["state"] == "triggered"


def test_sweep_of_an_alert_that_was_not_evaluated_up_to_its_expiry_requests_a_catch_up():
    exp = T + 3600
    data = [bar(T + 1800, 99, 101, 99, 100.5), bar(T + 3540, 99, 99, 99, 99)]
    r = Rig(mk(cond="cross_up", level=100.0, checked_at=T, expires_at=exp), bars=data)
    r.now = float(exp + 10)
    r.engine.sweep()  # không tick nào (backend vừa bật, thị trường đóng)
    assert r.requests == [SYM]
    r.settle()
    assert len(r.fired) == 1 and r.fired[0].time == T + 1800


def test_expired_without_a_gap_is_not_scanned():
    r = Rig(mk(cond="cross_up", level=100.0, checked_at=T + 3590, expires_at=T + 3600))
    r.now = float(T + 3700)
    r.engine.sweep()
    assert r.requests == [] and r.engine._late == []


# --- 6. báo bù chờ nến của khoảng đứt về DB --------------------------------------------------------------------------------------------------------------

def test_catch_up_waits_for_the_bars_of_the_gap_not_just_any_m1_message():
    data = [bar(T, 99, 99.5, 98.5, 99)]
    r = Rig(mk("cross_up", 100), bars=data)
    r.tick(99, T + 30)
    r.tick(99, T + 905)
    r.settle()  # EA vừa gửi vài nến M1 khác (vd seeding) rồi im: nến của khoảng đứt chưa có
    assert r.fired == [] and r.engine._by_symbol[SYM][0].catch is not None
    r.data += [bar(T + 120, 99, 101, 98.8, 100.5), bar(T + 900, 99, 99, 99, 99)]  # nến của khoảng đứt về
    r.settle()
    assert len(r.fired) == 1 and r.fired[0].time == T + 120


def test_catch_up_still_gives_up_waiting():
    r = Rig(mk("cross_up", 100), bars=[bar(T, 99, 99.5, 98.5, 99), bar(T + 120, 99, 101, 98.8, 100.5)])
    r.tick(99, T + 30)
    r.tick(99, T + 905)
    r.now += CATCHUP_WAIT + 1
    r.engine.run_catchups()
    assert len(r.fired) == 1


# --- 3 (Dispatcher). Telegram chậm không làm trễ web ---------------------------------------------------------------------------------------------------------

class _SlowTelegram:
    def __init__(self):
        self.gate = threading.Event()

    def send(self, chat, text):
        self.gate.wait(5)
        return "ok"


def _fired(uid="u1", **ch):
    a = {"id": "x", "user_id": uid, "symbol": SYM, "cond": "gt", "level": 1.0, "name": "", "message": "", "drawing": None, "channels": {"web": False, "telegram": False, "mt5": False, **ch}}
    return Fired(a, 2.0, T)


def test_web_delivery_does_not_wait_for_a_slow_telegram_send():
    tg = _SlowTelegram()
    web, logs = [], []
    d = notify.Dispatcher(send_web=lambda uid, m: (web.append(m["type"]), 1)[1], telegram=tg, chat_of=lambda uid: 1, mt5=None, log_add=lambda f: len(logs) + 1,  # type: ignore[arg-type]
                          log_set=lambda i, r: logs.append((i, r)), coalesce=0.0)
    d.start()
    try:
        d.submit(_fired(web=True, telegram=True))
        time.sleep(0.3)  # Telegram của lần nổ đầu đang treo
        d.submit(_fired(web=True))
        deadline = time.time() + 2
        while web.count("alert_fired") < 2 and time.time() < deadline:
            time.sleep(0.02)
        assert web.count("alert_fired") == 2  # toast của lần nổ thứ hai đã đi dù Telegram vẫn treo
    finally:
        tg.gate.set()
    deadline = time.time() + 2
    while len(logs) < 2 and time.time() < deadline:
        time.sleep(0.02)
    assert sorted((r for _, r in logs), key=len) == [{"web": "ok"}, {"web": "ok", "telegram": "ok"}]  # lần nổ chỉ có web xong trước


def test_dispatcher_skips_mt5_for_users_who_do_not_own_the_terminal():
    pushed, logs = [], []

    class FakePush:
        def send(self, text):
            pushed.append(text)
            return "ok"

    d = notify.Dispatcher(send_web=lambda uid, m: 0, telegram=None, chat_of=lambda uid: None, mt5=FakePush(), log_add=lambda f: 1,  # type: ignore[arg-type]
                          log_set=lambda i, r: logs.append(r), mt5_allowed=lambda uid: uid == "owner")
    d.handle([_fired("other", mt5=True)])
    assert pushed == [] and "chủ máy" in logs[-1]["mt5"]
    d.handle([_fired("owner", mt5=True)])
    assert len(pushed) == 1 and logs[-1]["mt5"] == "ok"


# --- 5 / 9. API: kênh MT5 chỉ cho chủ máy, giới hạn số alert khi bật lại ------------------------------------------------------------------------------------

def _user(email):
    c = TestClient(app, headers=ORIGIN)
    uid = c.post("/auth/register", json={"email": email, "password": "correct horse"}).json()["user"]["id"]
    return c, uid


def test_only_the_terminal_owner_may_use_the_mt5_channel():
    owner, owner_id = _user("owner@example.com")
    other, _ = _user("other@example.com")
    body = {"symbol": SYM, "cond": "cross", "level": 100.0, "channels": {"mt5": True}}
    assert alerts.mt5_owner() == owner_id
    assert owner.post("/alerts", json=body).status_code == 201
    assert owner.get("/alerts/channels").json()["mt5"]["allowed"] is True
    r = other.post("/alerts", json=body)
    assert r.status_code == 422 and "chủ máy" in r.json()["detail"]
    assert other.get("/alerts/channels").json()["mt5"]["allowed"] is False
    assert other.post("/alerts/channels/mt5/test").status_code == 403


def test_mt5_owner_falls_back_when_the_legacy_owner_account_is_gone():
    _, first_id = _user("first@example.com")
    with state.meta.tx() as db:
        db.execute("INSERT OR REPLACE INTO settings (id, scope, data) VALUES (?,?,?)", (accounts.LEGACY_FLAG, "", json.dumps({"user_id": "f" * 32, "rows": 1, "at": 1})))
    try:
        assert alerts.mt5_owner() == first_id  # cờ trỏ vào tài khoản đã xoá -> tài khoản tạo sớm nhất
    finally:
        with state.meta.tx() as db:
            db.execute("DELETE FROM settings WHERE id=?", (accounts.LEGACY_FLAG,))


def test_reactivating_as_paused_counts_toward_the_live_limit(monkeypatch):
    c, uid = _user("a@example.com")
    made = c.post("/alerts", json={"symbol": SYM, "cond": "cross", "level": 100.0, "channels": {"web": True}}).json()
    with state.meta.tx() as db:
        db.execute("UPDATE alerts SET state='triggered' WHERE id=?", (made["id"],))
    alerts.engine.sync(made["id"], None)
    monkeypatch.setattr(alerts, "MAX_LIVE", 0)
    assert c.patch(f"/alerts/{made['id']}", json={"state": "paused"}).status_code == 409
    monkeypatch.setattr(alerts, "MAX_LIVE", 100)
    assert c.patch(f"/alerts/{made['id']}", json={"state": "paused"}).json()["state"] == "paused"


def test_resuming_a_paused_alert_past_its_expiry_is_rejected():
    c, uid = _user("a@example.com")
    made = c.post("/alerts", json={"symbol": SYM, "cond": "cross", "level": 100.0, "channels": {"web": True}, "expires_at": int(time.time()) + 3600}).json()
    c.patch(f"/alerts/{made['id']}", json={"state": "paused"})
    with state.meta.tx() as db:
        db.execute("UPDATE alerts SET expires_at=? WHERE id=?", (int(time.time()) - 10, made["id"]))
    assert c.patch(f"/alerts/{made['id']}", json={"state": "active"}).status_code == 422


@pytest.fixture(autouse=True)
def _no_settings_flag():
    with state.meta.tx() as db:
        db.execute("DELETE FROM settings WHERE id=?", (alerts.accounts.LEGACY_FLAG,))
    yield
