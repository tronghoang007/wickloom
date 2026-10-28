import asyncio
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import accounts, alerts, auth, config, mt5, notify, state, tcp_server
from app.alerts import Alert, Engine, hit
from app.main import app
from app.models import TicksIn
from app.notify import Fired, Mt5Push, PushLimiter, Telegram, TelegramLinker

ORIGIN = {"Origin": "http://localhost:3000"}
PW = "correct horse"
SYM = "XAUUSDm"
T0 = 1_800_000_000  # giây UTC, rơi đúng đầu một phút


@pytest.fixture(autouse=True)
def clean():
    with state.meta.tx() as db:
        for t in ("alerts", "alert_log", "notify_channels", "sessions", "users"):
            db.execute(f"DELETE FROM {t}")
    engine_reset()
    state.symbols[SYM] = {"name": SYM}
    mt5.registry.clear()
    auth.throttle.fails.clear()
    alerts.dispatcher._q.queue.clear()
    alerts._last_test.clear()
    real = accounts.PBKDF2_ITER
    accounts.PBKDF2_ITER = 1_000
    yield
    accounts.PBKDF2_ITER = real
    state.symbols.pop(SYM, None)
    engine_reset()
    mt5.registry.clear()


def engine_reset():
    alerts.engine._by_symbol.clear()


class Clock:
    def __init__(self, t=T0):
        self.t = float(t)

    def __call__(self):
        return self.t


def mk(cond="cross", level=100.0, trigger="once", tf="M1", **kw) -> Alert:
    return Alert(id=kw.pop("id", "a1"), user_id="u1", symbol=SYM, cond=cond, level=level, trigger=trigger, tf=tf, expires_at=kw.pop("expires_at", None), name="", message="",
                 channels={"web": True, "telegram": False, "mt5": False}, state="active", created_at=T0, **kw)


class Rig:
    """Engine với đồng hồ giả; ghi lại các lần nổ và các lần ghi DB."""

    def __init__(self, *alist: Alert):
        self.clock = Clock()
        self.fired = []
        self.saved = []
        self.engine = Engine(self.fired.append, lambda a: self.saved.append((a.id, a.state)), self.clock)
        self.engine.load(alist)

    def tick(self, p, dt=1.0):
        self.clock.t += dt
        self.engine.on_price(SYM, int(self.clock.t * 1000), p, 0)

    def prices(self, *ps):
        for p in ps:
            self.tick(p)
        return [f.price for f in self.fired]


# --- điều kiện ---------------------------------------------------------------------------------------------------------------------------------------------

def test_hit_truth_table():
    assert hit("cross", 100, 99, 101) and hit("cross", 100, 101, 99) and hit("cross", 100, 99, 100)  # chạm đúng mức tính là cắt
    assert not hit("cross", 100, 99, 99.5) and not hit("cross", 100, None, 101)  # chưa có mốc: tick đầu không phải cắt
    assert hit("cross_up", 100, 99, 101) and not hit("cross_up", 100, 101, 99)
    assert hit("cross_down", 100, 101, 99) and not hit("cross_down", 100, 99, 101)
    assert not hit("cross", 100, 100, 101) and not hit("cross", 100, 100, 99)  # đang nằm đúng ở mức rồi đi tiếp: không nổ lại
    assert hit("gt", 100, None, 100.01) and not hit("gt", 100, None, 100)
    assert hit("lt", 100, None, 99.99) and not hit("lt", 100, None, 100)


def test_first_tick_only_sets_the_reference():
    r = Rig(mk("cross", 100))
    assert r.prices(101) == []  # giá đã ở trên mức lúc tạo: không bắn
    assert r.prices(99) == [99]


def test_price_jumping_over_the_level_after_a_gap_still_crosses():
    r = Rig(mk("cross_up", 100, "every_time"))
    r.tick(95)
    r.tick(130, dt=3600)  # tick đứt rồi nối lại, giá nhảy qua mức
    assert [f.price for f in r.fired] == [130]


def test_cross_directions():
    up, down = Rig(mk("cross_up", 100, "every_time")), Rig(mk("cross_down", 100, "every_time"))
    for p in (99, 101, 99, 101):
        up.tick(p, dt=10)
        down.tick(p, dt=10)
    assert [f.price for f in up.fired] == [101, 101] and [f.price for f in down.fired] == [99]


def test_once_marks_triggered_and_leaves_memory():
    r = Rig(mk("cross", 100))
    r.prices(99, 101, 99, 101)
    assert len(r.fired) == 1 and r.fired[0].alert["state"] == "triggered" and r.fired[0].alert["fire_count"] == 1
    assert r.saved == [("a1", "triggered")] and r.engine.symbols() == set()


def test_gt_fires_immediately_when_already_true():
    r = Rig(mk("gt", 100))
    assert r.prices(101) == [101]


def test_once_per_bar_fires_one_time_in_each_bar():
    r = Rig(mk("cross", 100, "once_per_bar"))
    r.clock.t = T0  # đầu phút
    r.tick(99, dt=1)
    r.tick(101, dt=1)  # nổ ở nến T0
    r.tick(99, dt=1)
    r.tick(101, dt=1)  # cùng nến: bỏ qua
    assert len(r.fired) == 1
    r.tick(99, dt=60)
    r.tick(101, dt=1)  # nến kế
    assert len(r.fired) == 2 and r.engine.symbols() == {SYM}


def test_every_time_is_throttled():
    r = Rig(mk("cross", 100, "every_time"))
    r.tick(99)
    for p in (101, 99, 101):  # 3 lần cắt trong 3 giây
        r.tick(p)
    assert len(r.fired) == 1
    r.tick(99, dt=alerts.REFIRE_GAP)
    assert len(r.fired) == 2


def test_once_per_bar_close_looks_only_at_closes():
    r = Rig(mk("cross_up", 100, "once_per_bar_close"))
    r.prices(99, 105, 99)  # tick không làm nổ
    assert r.fired == []
    close = lambda c: r.engine.on_bar_close(SYM, "M1", {"t": T0, "o": c, "h": c, "l": c, "c": c, "v": 1})
    close(99)  # lần đóng đầu chỉ làm mốc
    close(101)
    assert [f.price for f in r.fired] == [101]
    close(99)
    close(103)  # lặp lại mỗi nến thỏa điều kiện, không chuyển sang triggered
    assert len(r.fired) == 2 and r.engine.symbols() == {SYM}
    r.engine.on_bar_close(SYM, "M5", {"t": T0, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1})  # khác TF: bỏ qua
    assert len(r.fired) == 2


def test_expired_alert_does_not_fire_and_is_saved():
    r = Rig(mk("gt", 100, expires_at=int(T0 + 5)))
    r.tick(50)
    r.tick(150, dt=10)  # sau hạn
    assert r.fired == [] and r.saved == [("a1", "expired")] and r.engine.symbols() == set()


def test_sweep_expires_without_ticks():
    r = Rig(mk("gt", 100, expires_at=int(T0 + 5)))
    r.clock.t += 10
    r.engine.sweep()
    assert r.saved == [("a1", "expired")]


def test_restart_resets_the_reference():
    a = mk("cross", 100)
    first = Rig(a)
    first.tick(99)
    second = Rig(mk("cross", 100))  # engine mới nạp lại từ DB (backend khởi động lại)
    second.tick(101)  # tick đầu sau khởi động chỉ làm mốc
    assert second.fired == []


def test_sync_replaces_and_removes():
    r = Rig(mk("cross", 100))
    r.tick(99)
    r.engine.sync("a1", mk("cross", 50))  # sửa mức: mốc đặt lại
    r.tick(101)
    assert r.fired == []
    r.engine.sync("a1", None)
    assert r.engine.symbols() == set()


def test_engine_error_never_breaks_the_tick_path():
    def boom(_):
        raise RuntimeError("x")

    eng = Engine(boom, lambda a: None, Clock())
    eng.load([mk("gt", 1)])
    eng.on_price(SYM, T0 * 1000, 5.0, 0)  # không ném


# --- giới hạn MT5 + push -----------------------------------------------------------------------------------------------------------------------------------

def test_push_limiter_spacing_and_per_minute_cap():
    c = Clock()
    lim = PushLimiter(c)
    assert lim.reserve() == 0
    assert lim.reserve() == pytest.approx(notify.MT5_MIN_GAP)  # tin thứ hai trong cùng giây phải chờ
    c.t += 10
    # các tin đã xếp hàng (chưa gửi hết) làm tin sau phải chờ thêm: 2/giây nghĩa là cách nhau 0,5s
    waits = [lim.reserve() for _ in range(notify.MT5_PER_MIN - 2)]
    assert waits == pytest.approx([i * notify.MT5_MIN_GAP for i in range(len(waits))])
    assert lim.reserve() == -1  # hết hạn mức trong phút
    c.t += 61
    assert lim.reserve() == 0


class FakeEaHub:
    def __init__(self, push=None):
        self.sent = []
        self.on_push = push

    def push(self, msg):
        self.sent.append(msg)
        if self.on_push:
            self.on_push(msg)


def acct(**kw):
    return [{"online": True, "ea_version": "2.19", "push_enabled": True, **kw}]


def make_push(accounts_, ok=True, clock=None):
    hub = FakeEaHub()
    p = Mt5Push(hub, lambda: accounts_, PushLimiter(clock or Clock()), sleep=lambda s: None, wait=0.2)
    hub.on_push = lambda m: p.resolve({"id": m["id"], "ok": ok, "err": 0 if ok else 4516}) if ok is not None else None
    return p, hub


def test_mt5_push_reasons_when_it_cannot_send():
    assert make_push([])[0].send("x") == "EA offline"
    assert "2.19" in make_push(acct(ea_version="2.18"))[0].send("x")
    assert "Push Notifications" in make_push(acct(push_enabled=False))[0].send("x")
    p, hub = make_push(acct(), ok=False)
    assert "4516" in p.send("x") and len(hub.sent) == 1
    assert make_push(acct(), ok=None)[0].send("x").startswith("đã gửi cho EA nhưng")  # EA không trả lời


def test_mt5_push_sends_one_flat_message_within_255_chars():
    p, hub = make_push(acct())
    assert p.send('a "quoted"\n' + "y" * 400) == "ok"
    msg = hub.sent[0]
    assert msg["type"] == "notify" and len(msg["text"]) == 255 and '"' not in msg["text"] and "\n" not in msg["text"]


def test_ea_lines_carry_non_ascii_text_as_raw_utf8():
    """EA đọc JSON bằng tìm chuỗi (JsonStr) nên không giải mã \\uXXXX: tên / nội dung tiếng Việt của alert phải đi nguyên byte UTF-8."""
    class W:
        data = b""

        def write(self, d):
            self.data += d

        async def drain(self):
            pass

    w = W()
    asyncio.run(state.EaHub()._send(w, {"type": "notify", "id": 1, "text": "phá 3995 🔔"}))
    assert "phá 3995 🔔".encode("utf-8") in w.data and b"\\u" not in w.data


def test_mt5_push_unknown_push_state_still_tries():
    p, hub = make_push(acct(push_enabled=None))  # EA 2.19 chưa báo cờ: cứ thử, EA sẽ báo kết quả
    assert p.send("x") == "ok" and hub.sent


def test_mt5_push_drops_over_the_minute_cap():
    p, hub = make_push(acct())
    res = [p.send(f"m{i}") for i in range(notify.MT5_PER_MIN + 2)]
    assert res[:notify.MT5_PER_MIN] == ["ok"] * notify.MT5_PER_MIN and all(r.startswith("bỏ") for r in res[notify.MT5_PER_MIN:])
    assert len(hub.sent) == notify.MT5_PER_MIN


# --- Telegram ----------------------------------------------------------------------------------------------------------------------------------------------

TOKEN = "123456:SECRET-TOKEN"


def tg_with(handler, sleeps=None):
    return Telegram(lambda: TOKEN, httpx.MockTransport(handler), sleep=(sleeps.append if sleeps is not None else (lambda s: None)))


def test_telegram_send_ok_and_payload():
    seen = []

    def handler(req):
        seen.append((str(req.url), json.loads(req.content)))
        return httpx.Response(200, json={"ok": True})

    assert tg_with(handler).send(42, "<b>hi</b>") == "ok"
    url, body = seen[0]
    assert url.endswith(f"/bot{TOKEN}/sendMessage") and body["chat_id"] == 42 and body["parse_mode"] == "HTML"


def test_telegram_respects_retry_after_then_succeeds():
    calls, sleeps = [], []

    def handler(req):
        calls.append(1)
        return httpx.Response(429, json={"ok": False, "parameters": {"retry_after": 3}}) if len(calls) == 1 else httpx.Response(200, json={"ok": True})

    assert tg_with(handler, sleeps).send(1, "x") == "ok" and sleeps == [3]


def test_telegram_gives_up_on_long_rate_limit_and_on_4xx_without_retry():
    n = []
    assert "chờ 120s" in tg_with(lambda r: httpx.Response(429, json={"parameters": {"retry_after": 120}})).send(1, "x")

    def handler(req):
        n.append(1)
        return httpx.Response(403, json={"ok": False, "description": "Forbidden: bot was blocked by the user"})

    res = tg_with(handler).send(1, "x")
    assert "403" in res and "blocked" in res and len(n) == 1


def test_telegram_network_error_retries_and_never_leaks_the_token():
    n = []

    def handler(req):
        n.append(1)
        raise httpx.ConnectError(f"cannot connect to {req.url}")

    res = tg_with(handler).send(1, "x")
    assert len(n) == 3 and "lỗi mạng" in res and TOKEN not in res and "SECRET" not in res


def test_telegram_5xx_retries():
    n = []

    def handler(req):
        n.append(1)
        return httpx.Response(502, text="bad gateway") if len(n) < 3 else httpx.Response(200, json={"ok": True})

    assert tg_with(handler).send(1, "x") == "ok" and len(n) == 3


def test_telegram_without_token_says_so():
    assert "WICKLOOM_TG_BOT_TOKEN" in Telegram(lambda: "", httpx.MockTransport(lambda r: httpx.Response(200))).send(1, "x")


def fired(**kw) -> Fired:
    a = mk("cross_up", 4000.5).public(with_user=True)
    a.update(kw)
    return Fired(a, 4001.25, T0)


def test_telegram_text_escapes_user_html():
    t = notify.telegram_text(fired(name="<script>x</script> & co", message="a < b"))
    assert "<script>" not in t and "&lt;script&gt;" in t and "a &lt; b" in t and "<b>" in t and "4000.5" in t and "4001.25" in t


def test_push_texts():
    assert notify.push_text(fired(name="Gold", message="look")) == "Gold: XAUUSDm Crossing Up 4000.5 @ 4001.25 - look"
    merged = notify.push_merged([fired(name="A"), fired(name="B"), fired(name="")])
    assert merged.startswith("3 alert: A, B, XAUUSDm Crossing Up")


# --- liên kết Telegram ------------------------------------------------------------------------------------------------------------------------------------

def make_linker(clock=None):
    sent, linked = [], []
    tg = tg_with(lambda r: (sent.append(json.loads(r.content)), httpx.Response(200, json={"ok": True}))[1])
    return TelegramLinker(tg, lambda uid, chat, who: linked.append((uid, chat, who)), clock or Clock()), sent, linked


def start(text, chat=777, kind="private"):
    return {"update_id": 1, "message": {"text": text, "chat": {"id": chat, "type": kind, "first_name": "Trong"}}}


def test_link_code_works_once():
    ln, sent, linked = make_linker()
    code = ln.new_code("u1")
    ln.handle_update(start(f"/start {code}"))
    assert linked == [("u1", 777, "Trong")] and "Đã kết nối" in sent[-1]["text"]
    ln.handle_update(start(f"/start {code}", chat=888))  # dùng lần hai
    assert linked == [("u1", 777, "Trong")] and "không hợp lệ" in sent[-1]["text"]


def test_link_code_expires_after_ten_minutes():
    clock = Clock()
    ln, sent, linked = make_linker(clock)
    code = ln.new_code("u1")
    clock.t += notify.LINK_TTL + 1
    ln.handle_update(start(f"/start {code}"))
    assert linked == [] and "hết hạn" in sent[-1]["text"]


def test_link_rejects_unknown_code_groups_and_other_text():
    ln, sent, linked = make_linker()
    ln.new_code("u1")
    ln.handle_update(start("/start not-a-real-code"))
    ln.handle_update(start("/start abcdefgh12", kind="group"))
    ln.handle_update(start("hello"))
    ln.handle_update({"update_id": 2})
    assert linked == [] and len(sent) == 1  # chỉ trả lời mã sai, bỏ qua nhóm và tin thường


def test_new_code_replaces_the_previous_one_of_the_same_user():
    ln, _, linked = make_linker()
    old, new = ln.new_code("u1"), ln.new_code("u1")
    ln.handle_update(start(f"/start {old}"))
    ln.handle_update(start(f"/start {new}"))
    assert linked == [("u1", 777, "Trong")]


# --- Dispatcher --------------------------------------------------------------------------------------------------------------------------------------------

class Rec:
    def __init__(self, web=1, chat=None, push="ok"):
        self.web_calls, self.logs, self.set, self.tg, self.pushes = [], [], {}, [], []
        self.web, self.chat, self.push = web, chat, push

    def build(self):
        tg = tg_with(lambda r: (self.tg.append(json.loads(r.content)), httpx.Response(200, json={"ok": True}))[1])
        mt5p = type("P", (), {"send": lambda s, text: (self.pushes.append(text), self.push)[1]})()
        return notify.Dispatcher(send_web=lambda uid, m: (self.web_calls.append((uid, m)), self.web)[1], telegram=tg, chat_of=lambda uid: self.chat, mt5=mt5p,
                                 log_add=lambda f: (self.logs.append(f), len(self.logs))[1], log_set=lambda i, r: self.set.__setitem__(i, r))


def chans(**kw):
    return {"web": False, "telegram": False, "mt5": False, **kw}


def test_dispatcher_reports_each_channel_result():
    rec = Rec(web=0, chat=None)
    rec.build().handle([fired(channels=chans(web=True, telegram=True))])
    assert rec.set[1] == {"web": "không có tab Wickloom nào đang mở", "telegram": "chưa kết nối Telegram"}
    fired_msg = rec.web_calls[0][1]
    assert fired_msg["type"] == "alert_fired" and "user_id" not in fired_msg["alert"] and fired_msg["log_id"] == 1
    assert rec.web_calls[-1][1]["type"] == "alert_delivery" and rec.web_calls[-1][1]["results"] == rec.set[1]


def test_dispatcher_sends_telegram_to_the_linked_chat_only_when_enabled():
    rec = Rec(chat=555)
    rec.build().handle([fired(channels=chans(telegram=True)), fired(channels=chans(web=True))])
    assert len(rec.tg) == 1 and rec.tg[0]["chat_id"] == 555 and rec.set[1] == {"telegram": "ok"} and rec.set[2] == {"web": "ok"}


def test_dispatcher_merges_a_burst_into_one_mt5_push():
    rec = Rec()
    rec.build().handle([fired(channels=chans(mt5=True), name=n) for n in "ABC"])
    assert len(rec.pushes) == 1 and rec.pushes[0].startswith("3 alert: A, B, C")
    assert all(rec.set[i]["mt5"] == "ok" for i in (1, 2, 3))
    rec2 = Rec(push="EA offline")
    rec2.build().handle([fired(channels=chans(mt5=True))])
    assert rec2.set[1] == {"mt5": "EA offline"} and "Crossing Up" in rec2.pushes[0]


# --- API ---------------------------------------------------------------------------------------------------------------------------------------------------

def client():
    return TestClient(app, headers=ORIGIN)


def login(c, email="a@example.com"):
    r = c.post("/auth/register", json={"email": email, "password": PW})
    assert r.status_code == 201
    return r.json()["user"]["id"]


BODY = {"symbol": SYM, "cond": "cross", "level": 4000.5, "trigger": "once", "tf": "M1", "name": "Gold", "message": "hi", "channels": {"web": True}}


def test_alert_api_requires_login():
    c = client()
    for r in (c.get("/alerts"), c.post("/alerts", json=BODY), c.get("/alerts/log"), c.get("/alerts/channels"), c.delete("/alerts/x"), c.post("/alerts/channels/web/test")):
        assert r.status_code == 401


def test_create_list_patch_delete_roundtrip_keeps_engine_in_sync():
    c = client()
    uid = login(c)
    r = c.post("/alerts", json=BODY)
    assert r.status_code == 201
    a = r.json()
    assert a["state"] == "active" and a["channels"] == {"web": True, "telegram": False, "mt5": False} and "user_id" not in a
    assert SYM in alerts.engine.symbols() and SYM in state.wanted_symbols()  # EA phải stream tick dù không chart nào mở
    assert [x["id"] for x in c.get("/alerts").json()] == [a["id"]]

    r = c.patch(f"/alerts/{a['id']}", json={"level": 4100, "state": "paused", "name": "Gold 2"})
    assert r.json()["level"] == 4100 and r.json()["state"] == "paused" and r.json()["name"] == "Gold 2"
    assert alerts.engine.symbols() == set() and SYM not in state.wanted_symbols()
    assert c.patch(f"/alerts/{a['id']}", json={"state": "active"}).json()["state"] == "active" and SYM in alerts.engine.symbols()

    assert c.delete(f"/alerts/{a['id']}").json() == {"ok": True}
    assert c.get("/alerts").json() == [] and alerts.engine.symbols() == set() and c.delete(f"/alerts/{a['id']}").status_code == 404
    assert alerts.db_get(uid, a["id"]) is None


def test_on_chart_defaults_off_and_survives_a_reload_from_the_db():
    c = client()
    uid = login(c)
    assert c.post("/alerts", json=BODY).json()["on_chart"] is False
    a = c.post("/alerts", json={**BODY, "level": 4010, "on_chart": True}).json()
    assert a["on_chart"] is True and alerts.db_get(uid, a["id"]).on_chart is True  # lưu xuống DB, đọc lại vẫn True
    assert c.patch(f"/alerts/{a['id']}", json={"name": "x"}).json()["on_chart"] is True  # sửa trường khác không đụng cờ
    assert c.patch(f"/alerts/{a['id']}", json={"on_chart": False}).json()["on_chart"] is False


def test_other_users_alerts_are_invisible_and_untouchable():
    a_c, b_c = client(), client()
    login(a_c, "a@example.com")
    login(b_c, "b@example.com")
    aid = a_c.post("/alerts", json=BODY).json()["id"]
    assert b_c.get("/alerts").json() == []
    assert b_c.patch(f"/alerts/{aid}", json={"level": 1}).status_code == 404
    assert b_c.delete(f"/alerts/{aid}").status_code == 404
    assert a_c.get("/alerts").json()[0]["level"] == 4000.5  # không bị B đổi


def test_validation_errors():
    c = client()
    login(c)
    bad = lambda **kw: c.post("/alerts", json={**BODY, **kw}).status_code
    assert bad(cond="between") == 422 and bad(trigger="always") == 422 and bad(tf="M7") == 422 and bad(tf="MN1") == 422
    assert bad(symbol="NOPE") == 422 and bad(symbol="  ") == 422
    assert bad(level=1e15) == 422
    assert c.post("/alerts", content='{"symbol":"XAUUSDm","cond":"cross","level":NaN}', headers={"Content-Type": "application/json"}).status_code == 422
    assert bad(message="x" * 201) == 422 and bad(name="x" * 61) == 422
    assert bad(expires_at=int(time.time()) - 5) == 422
    assert bad(channels={}) == 422 and bad(channels={"web": False}) == 422
    assert bad(channels={"web": True, "telegram": True}) == 422  # chưa kết nối Telegram
    assert bad(channels={"web": False, "mt5": True}) == 201
    assert bad(message="x" * 200) == 201


def test_message_is_cleaned_of_control_characters():
    c = client()
    login(c)
    a = c.post("/alerts", json={**BODY, "message": "a\x00b\x07c\nd"}).json()
    assert a["message"] == "abc\nd"


def test_live_alert_limit_counts_active_and_paused_only():
    c = client()
    uid = login(c)
    for i in range(alerts.MAX_LIVE):
        assert c.post("/alerts", json={**BODY, "level": 4000 + i}).status_code == 201
    r = c.post("/alerts", json=BODY)
    assert r.status_code == 409
    first = c.get("/alerts").json()[0]
    c.delete(f"/alerts/{first['id']}")
    assert c.post("/alerts", json=BODY).status_code == 201
    other = client()
    login(other, "b@example.com")
    assert other.post("/alerts", json=BODY).status_code == 201  # giới hạn theo từng user
    assert alerts.db_live_count(uid) == alerts.MAX_LIVE


def test_rearming_a_triggered_alert_needs_room_and_a_future_expiry():
    c = client()
    login(c)
    a = c.post("/alerts", json={**BODY, "expires_at": int(time.time()) + 3600}).json()
    with state.meta.tx() as db:
        db.execute("UPDATE alerts SET state='triggered', expires_at=? WHERE id=?", (int(time.time()) - 5, a["id"]))
    assert c.patch(f"/alerts/{a['id']}", json={"state": "active"}).status_code == 422  # hạn đã qua
    r = c.patch(f"/alerts/{a['id']}", json={"state": "active", "clear_expiry": True})
    assert r.status_code == 200 and r.json()["state"] == "active" and r.json()["expires_at"] is None
    assert c.patch(f"/alerts/{a['id']}", json={"state": "gone"}).status_code == 422


def test_ticks_from_the_ea_fire_a_stored_alert_and_log_it():
    c = client()
    uid = login(c)
    a = c.post("/alerts", json={**BODY, "cond": "cross_up", "level": 4000}).json()
    now_ms = int(time.time() * 1000)
    for i, bid in enumerate((3999.0, 4001.0)):
        tcp_server._handle_ticks(TicksIn(symbol=SYM, ticks=[{"t_msc": now_ms + i, "bid": bid, "ask": bid + 0.1, "last": 0, "vol": 0}]))
    f = alerts.dispatcher._q.get_nowait()
    assert f.alert["id"] == a["id"] and f.alert["user_id"] == uid and f.price == 4001.0
    assert alerts.dispatcher._q.empty()  # once: không nổ lại
    assert c.get("/alerts").json()[0]["state"] == "triggered" and c.get("/alerts").json()[0]["fire_count"] == 1
    alerts.dispatcher.send_web = lambda *_: 0
    alerts.dispatcher.handle([f])
    log = c.get("/alerts/log").json()
    assert len(log) == 1 and log[0]["price"] == 4001.0 and log[0]["results"]["web"].startswith("không có tab")


def test_all_ticks_of_one_batch_are_checked_not_only_the_last():
    c = client()
    login(c)
    c.post("/alerts", json={**BODY, "cond": "cross_up", "level": 4000})
    now_ms = int(time.time() * 1000)
    ticks = [{"t_msc": now_ms + i, "bid": b, "ask": b + 0.1, "last": 0, "vol": 0} for i, b in enumerate((3999.0, 4002.0, 3998.0))]  # lên rồi quay xuống ngay trong một lô
    tcp_server._handle_ticks(TicksIn(symbol=SYM, ticks=ticks))
    assert alerts.dispatcher._q.qsize() == 1


def test_log_is_per_user_and_capped():
    c = client()
    uid = login(c)
    for i in range(alerts.LOG_KEEP + 5):
        alerts.log_add(fired(user_id=uid, id="x"))
    other = alerts.log_add(fired(user_id="someone-else", id="y"))
    rows = c.get(f"/alerts/log?limit={alerts.LOG_KEEP}").json()
    assert len(rows) == alerts.LOG_KEEP and all(r["alert_id"] == "x" for r in rows) and other > 0
    assert c.get("/alerts/log?limit=0").status_code == 422


def test_deleting_an_alert_keeps_its_history():
    c = client()
    uid = login(c)
    a = c.post("/alerts", json=BODY).json()
    alerts.log_add(fired(user_id=uid, id=a["id"]))
    c.delete(f"/alerts/{a['id']}")
    assert len(c.get("/alerts/log").json()) == 1


# --- kênh --------------------------------------------------------------------------------------------------------------------------------------------------

@pytest.fixture
def tg_bot(monkeypatch):
    """Bot Telegram giả: ghi lại tin gửi đi, getMe trả tên bot."""
    sent = []

    def handler(req):
        method = str(req.url).rsplit("/", 1)[-1]
        if method == "getMe":
            return httpx.Response(200, json={"ok": True, "result": {"username": "wickloom_bot"}})
        sent.append(json.loads(req.content))
        return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(config, "TG_BOT_TOKEN", TOKEN)
    monkeypatch.setattr(alerts.telegram, "_client", httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(alerts.telegram, "_username", None)
    return sent


def test_channels_status_and_telegram_unconfigured():
    c = client()
    login(c)
    ch = c.get("/alerts/channels").json()
    assert ch["telegram"] == {"configured": False, "linked": False, "name": None}
    assert ch["mt5"]["online"] is False and ch["mt5"]["push_enabled"] is None
    assert c.post("/alerts/channels/telegram/link").status_code == 503
    assert "WICKLOOM_TG_BOT_TOKEN" in c.post("/alerts/channels/telegram/test").json()["detail"]
    assert "token" not in json.dumps(ch).lower()


def test_telegram_link_flow_and_unlink(tg_bot):
    c = client()
    uid = login(c)
    r = c.post("/alerts/channels/telegram/link")
    assert r.status_code == 200 and r.json()["expires_in"] == notify.LINK_TTL
    url = r.json()["url"]
    assert url.startswith("https://t.me/wickloom_bot?start=") and TOKEN not in url
    code = url.split("start=")[1]
    alerts.linker.handle_update(start(f"/start {code}", chat=4242))  # người dùng mở link và bấm Start
    ch = c.get("/alerts/channels").json()["telegram"]
    assert ch == {"configured": True, "linked": True, "name": "Trong"} and alerts.chat_of(uid) == 4242
    other = client()
    login(other, "b@example.com")
    assert other.get("/alerts/channels").json()["telegram"]["linked"] is False  # kênh của A không lộ sang B
    assert c.post("/alerts", json={**BODY, "channels": {"telegram": True}}).status_code == 201
    assert c.post("/alerts/channels/telegram/test").json() == {"ok": True, "detail": "ok"}
    assert tg_bot[-1]["chat_id"] == 4242
    assert c.delete("/alerts/channels/telegram").json() == {"ok": True}
    assert c.get("/alerts/channels").json()["telegram"]["linked"] is False


def test_test_endpoint_is_throttled_and_rejects_unknown_kind():
    c = client()
    login(c)
    assert c.post("/alerts/channels/sms/test").status_code == 404
    first = c.post("/alerts/channels/mt5/test")
    assert first.status_code == 200 and first.json()["detail"] == "EA offline"
    assert c.post("/alerts/channels/mt5/test").status_code == 429


def test_web_test_reports_when_no_tab_is_open():
    c = client()
    login(c)
    assert c.post("/alerts/channels/web/test").json() == {"ok": False, "detail": "không có tab Wickloom nào đang mở"}


# --- WebSocket ---------------------------------------------------------------------------------------------------------------------------------------------

class _NoServer:
    def close(self):
        pass

    async def wait_closed(self):
        pass


@pytest.fixture(autouse=False)
def app_lifespan(monkeypatch):
    """`with TestClient(app)` chạy startup của app: không bind cổng EA 8001 (backend thật có thể đang chạy) và không bật thread nền của alert."""
    async def no_server():
        return _NoServer()

    monkeypatch.setattr(tcp_server, "start_server", no_server)
    monkeypatch.setattr(alerts, "start", lambda: None)

def test_ws_alert_feed_needs_login_and_a_known_origin(app_lifespan):
    with TestClient(app, headers=ORIGIN) as c:
        with c.websocket_connect("/ws") as ws:
            ws.send_json({"action": "alerts"})
            assert ws.receive_json() == {"type": "alerts_denied"}  # chưa đăng nhập
        uid = login(c)
        with pytest.raises(WebSocketDisconnect):  # Origin lạ: từ chối ngay lúc bắt tay (main.ws_endpoint), không chỉ phần alert
            with c.websocket_connect("/ws", headers={"Origin": "http://evil.example"}) as ws:
                ws.send_json({"action": "alerts"})
                ws.receive_json()
        with c.websocket_connect("/ws") as ws:
            ws.send_json({"action": "alerts"})
            assert ws.receive_json() == {"type": "alerts_ready"}
            assert state.hub.send_user(uid, {"type": "alert_test"}) == 1 and ws.receive_json() == {"type": "alert_test"}
            assert state.hub.send_user("other-user", {"type": "alert_test"}) == 0  # chỉ đúng chủ
        assert state.hub.alert_users == {}


def test_ws_delivery_reaches_only_the_owner_and_only_opted_in_connections(app_lifespan):
    with TestClient(app, headers=ORIGIN) as c:
        uid = login(c)
        with c.websocket_connect("/ws") as plain, c.websocket_connect("/ws") as feed:
            feed.send_json({"action": "alerts"})
            assert feed.receive_json()["type"] == "alerts_ready"
            rec = Rec(web=None)
            d = rec.build()
            d.send_web = state.hub.send_user
            d.handle([fired(user_id=uid, channels=chans(web=True))])
            msg = feed.receive_json()
            assert msg["type"] == "alert_fired" and msg["alert"]["symbol"] == SYM and msg["price"] == 4001.25
            assert feed.receive_json()["type"] == "alert_delivery"
            assert list(state.hub.alert_users.values()) == [uid] and len(state.hub.clients) == 2  # kết nối thường không nằm trong danh sách nhận alert
