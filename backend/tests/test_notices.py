"""Phase 3 của alert: tin không phải alert giá (rules.py, newswatch.py, tradewatch.py) và cách Dispatcher / nhật ký đối xử với chúng."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import accounts, alerts, auth, mt5, newswatch, notify, rules, state, tradewatch
from app.main import app
from app.notify import Fired
from app.tradewatch import TradeWatcher

ORIGIN = {"Origin": "http://localhost:3000"}
PW = "correct horse"
T = 1_800_000_000
AID = "Exness-MT5Trial17:123"


@pytest.fixture(autouse=True)
def clean():
    with state.meta.tx() as db:
        for t in ("alert_log", "notify_rules", "notify_channels", "news_sent", "trade_watch", "sessions", "users"):
            db.execute(f"DELETE FROM {t}")
    mt5.registry.clear()
    auth.throttle.fails.clear()
    real = accounts.PBKDF2_ITER
    accounts.PBKDF2_ITER = 1_000
    yield
    accounts.PBKDF2_ITER = real
    mt5.registry.clear()


def chans(**kw):
    return {"web": False, "telegram": False, "mt5": False, **kw}


# --- notice / Dispatcher / nhật ký -------------------------------------------------------------------------------------------------------------------------

def test_notice_texts_for_every_channel():
    f = notify.notice("u1", "news", "Economic news in 15 min", "USD NFP (High) 12:30 UTC", chans(web=True), T, message="Demo #1")
    tg = notify.telegram_text(f)
    assert "<b>Economic news in 15 min</b>" in tg and "USD NFP" in tg and "Demo #1" in tg
    assert notify.push_text(f) == "Economic news in 15 min: USD NFP (High) 12:30 UTC - Demo #1"
    assert "Economic news" in notify.push_merged([f, f])


def test_late_price_alert_is_labelled_on_every_channel():
    a = {"id": "a", "user_id": "u1", "symbol": "XAUUSDm", "cond": "cross_up", "level": 4000.0, "name": "", "message": "", "channels": chans(web=True), "drawing": None}
    late, live = Fired(a, 4000.0, T, late=True), Fired(a, 4000.0, T)
    assert notify.fired_line(late).startswith("(trễ) XAUUSDm Crossing Up 4000")
    assert "(trễ)" in notify.telegram_text(late) and notify.push_text(late).startswith("(trễ) XAUUSDm Crossing Up 4000")
    assert "(trễ)" not in notify.fired_line(live) and "(trễ)" not in notify.push_text(live)


class Rec:
    def __init__(self):
        self.web, self.logs, self.set, self.pushes, self.tg = [], [], {}, [], []

    def build(self):
        tg = notify.Telegram(lambda: "TOKEN", transport=httpx.MockTransport(lambda r: (self.tg.append(json.loads(r.content)), httpx.Response(200, json={"ok": True}))[1]))
        mt5p = type("P", (), {"send": lambda s, text: (self.pushes.append(text), "ok")[1]})()
        return notify.Dispatcher(send_web=lambda uid, m: (self.web.append(m), 1)[1], telegram=tg, chat_of=lambda uid: 99, mt5=mt5p,
                                 log_add=lambda f: (self.logs.append(f), len(self.logs))[1], log_set=lambda i, r: self.set.__setitem__(i, r))


def test_dispatcher_sends_notice_as_alert_notice_not_alert_fired():
    rec = Rec()
    f = notify.notice("u1", "trade", "SL hit", "BUY 0.1 XAUUSDm closed at 4001.2", chans(web=True, telegram=True, mt5=True), T, message="Demo #1")
    rec.build().handle([f])
    first = rec.web[0]
    assert first == {"type": "alert_notice", "kind": "trade", "title": "SL hit", "text": "BUY 0.1 XAUUSDm closed at 4001.2", "message": "Demo #1", "symbol": "", "time": T, "log_id": 1}
    assert rec.web[-1]["type"] == "alert_delivery" and rec.set[1] == {"web": "ok", "telegram": "ok", "mt5": "ok"}
    assert "SL hit" in rec.tg[0]["text"] and rec.pushes == ["SL hit: BUY 0.1 XAUUSDm closed at 4001.2 - Demo #1"]


def test_late_flag_reaches_the_web_message():
    rec = Rec()
    a = {"id": "a", "user_id": "u1", "symbol": "XAUUSDm", "cond": "cross", "level": 4000.0, "name": "", "message": "", "channels": chans(web=True), "drawing": None, "state": "active"}
    rec.build().handle([Fired(a, 4000.0, T, late=True)])
    assert rec.web[0]["type"] == "alert_fired" and rec.web[0]["late"] is True


def test_log_keeps_kind_text_and_late_flag():
    a = {"id": "a", "user_id": "u1", "symbol": "XAUUSDm", "cond": "cross", "level": 4000.0, "name": "", "message": "", "channels": chans(web=True), "drawing": None}
    alerts.log_add(Fired(a, 4000.0, T, late=True))
    alerts.log_add(notify.notice("u1", "news", "Economic news in 5 min", "USD CPI", chans(web=True), T + 1))
    news, price = alerts.log_list("u1", 10)
    assert (news["kind"], news["text"], news["late"]) == ("news", "USD CPI", False)
    assert (price["kind"], price["text"], price["late"]) == ("price", "", True)


# --- quy tắc (API) -----------------------------------------------------------------------------------------------------------------------------------------

def client():
    return TestClient(app, headers=ORIGIN)


def login(c, email="a@example.com"):
    r = c.post("/auth/register", json={"email": email, "password": PW})
    assert r.status_code == 201
    return r.json()["user"]["id"]


def test_rules_require_login():
    c = client()
    assert c.get("/alerts/rules").status_code == 401 and c.patch("/alerts/rules/news", json={}).status_code == 401


def test_rules_default_to_off_and_patch_merges():
    c = client()
    uid = login(c)
    r = c.get("/alerts/rules").json()
    assert r["news"]["enabled"] is False and r["news"]["leads"] == [15] and r["trade"]["enabled"] is False and r["trade"]["sl"] is True
    got = c.patch("/alerts/rules/news", json={"enabled": True, "leads": [5, 30, 5], "min_importance": 2, "currencies": ["usd", " eur "], "channels": {"web": True}})
    assert got.status_code == 200
    assert got.json() == {"enabled": True, "leads": [30, 5], "min_importance": 2, "currencies": ["EUR", "USD"], "channels": {"web": True, "telegram": False, "mt5": False}}
    assert c.patch("/alerts/rules/news", json={"min_importance": 3}).json()["leads"] == [30, 5]  # chỉ đổi trường gửi lên
    assert [u for u, _ in rules.enabled("news")] == [uid] and rules.enabled("trade") == []


@pytest.mark.parametrize("body", [
    {"leads": []}, {"leads": [0]}, {"leads": [1441]}, {"leads": [1, 2, 3, 4]}, {"leads": ["15"]}, {"leads": [True]}, {"leads": "15"},
    {"min_importance": 0}, {"min_importance": 4}, {"min_importance": True}, {"currencies": ["US$"]}, {"currencies": "USD"}, {"currencies": ["USD"] * 21},
    {"enabled": "yes"}, {"channels": "web"}, {"nope": 1},
])
def test_news_rule_rejects_bad_values(body):
    c = client()
    login(c)
    assert c.patch("/alerts/rules/news", json={"channels": {"web": True}, **body}).status_code == 422
    assert rules.enabled("news") == []


def test_trade_rule_flags_and_unknown_kind():
    c = client()
    login(c)
    assert c.patch("/alerts/rules/trade", json={"enabled": True, "tp": False, "channels": {"web": True}}).json()["tp"] is False
    assert c.patch("/alerts/rules/trade", json={"sl": "no"}).status_code == 422
    assert c.patch("/alerts/rules/trade", json={"leads": [5]}).status_code == 422  # tuỳ chọn của loại khác
    assert c.patch("/alerts/rules/other", json={}).status_code == 404


def test_enabled_rule_needs_a_channel_and_a_linked_telegram_but_a_disabled_one_does_not():
    c = client()
    uid = login(c)
    assert c.patch("/alerts/rules/news", json={"enabled": True, "channels": {}}).status_code == 422
    assert c.patch("/alerts/rules/news", json={"enabled": True, "channels": {"telegram": True}}).status_code == 422  # chưa kết nối
    assert c.patch("/alerts/rules/news", json={"enabled": False, "channels": {"telegram": True}}).status_code == 200  # chỉ cất cấu hình
    alerts.channel_set(uid, "telegram", {"chat_id": 5})
    assert c.patch("/alerts/rules/news", json={"enabled": True, "channels": {"telegram": True}}).status_code == 200


def test_rules_are_per_user():
    a, b = client(), client()
    ua, _ = login(a, "a@example.com"), login(b, "b@example.com")
    a.patch("/alerts/rules/trade", json={"enabled": True, "channels": {"web": True}})
    assert b.get("/alerts/rules").json()["trade"]["enabled"] is False
    assert [u for u, _ in rules.enabled("trade")] == [ua]


# --- tin kinh tế ------------------------------------------------------------------------------------------------------------------------------------------

def ev(i, t, **kw):
    return {"id": i, "time": t, "event_id": 100 + i, "country": "US", "currency": "USD", "name": f"Event {i}", "importance": 3, "unit": 1, "multiplier": 0, "digits": 1,
            "time_mode": 0, "impact": 0, "actual": None, "forecast": 3.5, "previous": 3.4, "revised": None, **kw}


class News:
    def __init__(self, evs, users=None, now=T):
        self.evs, self.now, self.out, self.calls = list(evs), now, [], []
        self.users = users if users is not None else [("u1", {**rules.DEFAULTS["news"], "enabled": True, "channels": chans(web=True)})]
        self.w = newswatch.NewsWatcher(self.out.append, lambda: self.users, self.events, lambda: self.now)

    def events(self, lo, hi, importance=0, currencies=None):
        self.calls.append((importance, currencies))
        return [e for e in self.evs if lo <= e["time"] <= hi]

    def at(self, dt):
        self.now = T + dt
        return self.w.tick()


def test_news_notifies_when_the_lead_is_reached_and_only_once():
    n = News([ev(1, T + 1200)])
    assert n.at(0) == 0  # còn 20 phút, mốc là 15
    assert n.at(299) == 0
    assert n.at(300) == 1  # còn đúng 15 phút
    f = n.out[0]
    assert f.kind == "news" and f.alert["name"] == "Economic news in 15 min" and f.alert["channels"] == chans(web=True) and f.alert["user_id"] == "u1"
    assert f.line == "USD Event 1 (High) 08:20 UTC · forecast 3.5% · prev 3.4%"
    assert n.at(310) == 0 and n.at(1199) == 0  # đã báo, không lặp
    assert len(n.out) == 1


def test_news_does_not_repeat_after_a_backend_restart():
    News([ev(1, T + 600)]).at(0)
    again = News([ev(1, T + 600)])
    assert again.at(10) == 0 and again.out == []


def test_events_at_the_same_time_make_one_notice():
    n = News([ev(1, T + 600, name="Non-Farm Payrolls"), ev(2, T + 600, name="Unemployment Rate"), ev(3, T + 840, name="Later")])
    assert n.at(0) == 2
    one, two = n.out
    assert one.line.count("\n") == 1 and "Non-Farm Payrolls" in one.line and "Unemployment Rate" in one.line and "Economic news in 10 min" == one.alert["name"]
    assert "Later" in two.line and "in 14 min" in two.alert["name"]


def test_several_leads_notify_at_each_and_a_late_start_notifies_once():
    cfg = {**rules.DEFAULTS["news"], "enabled": True, "leads": [60, 15], "channels": chans(web=True)}
    n = News([ev(2, T + 3700)], [("u1", cfg)])
    assert n.at(100) == 1 and "in 60 min" in n.out[0].alert["name"]  # còn 3600 s: mốc 60 tới hạn
    assert n.at(2800) == 1 and "in 15 min" in n.out[1].alert["name"]  # còn 900 s
    late = News([ev(3, T + 7200)], [("u1", cfg)])
    assert late.at(7200 - 180) == 1 and len(late.out) == 1 and "in 3 min" in late.out[0].alert["name"]  # cả hai mốc đã quá hạn: một tin
    assert late.at(7200 - 120) == 0


def test_news_skips_events_without_a_time_and_events_already_started():
    n = News([ev(1, T + 300, time_mode=1), ev(2, T + 300, time_mode=3), ev(3, T + 300, time_mode=2), ev(4, T)])
    assert n.at(0) == 0 and n.at(1) == 0 and n.out == []


def test_news_passes_the_users_filters_to_the_calendar():
    cfg = {**rules.DEFAULTS["news"], "enabled": True, "min_importance": 2, "currencies": ["EUR"], "channels": chans(web=True)}
    n = News([], [("u1", cfg)])
    n.at(0)
    assert n.calls == [(2, ["EUR"])]
    n2 = News([])
    n2.at(0)
    assert n2.calls == [(3, None)]  # rỗng = mọi đồng tiền


def test_each_user_gets_their_own_notice_and_dedup_is_per_user():
    cfg = lambda ch: {**rules.DEFAULTS["news"], "enabled": True, "channels": ch}
    n = News([ev(1, T + 300)], [("u1", cfg(chans(web=True))), ("u2", cfg(chans(telegram=True)))])
    assert n.at(0) == 2
    assert {f.alert["user_id"]: f.alert["channels"] for f in n.out} == {"u1": chans(web=True), "u2": chans(telegram=True)}
    assert n.at(1) == 0


def test_a_rescheduled_event_is_announced_again():
    n = News([ev(1, T + 600)])
    n.at(0)
    n.evs = [ev(1, T + 1500)]  # dời giờ
    assert n.at(700) == 1 and "in 14 min" in n.out[-1].alert["name"]


def test_fmt_value_matches_the_web_format():
    e = {"digits": 1, "multiplier": 0, "unit": 1}
    assert newswatch.fmt_value(3.8, e) == "3.8%" and newswatch.fmt_value(None, e) == "-" and newswatch.fmt_value(float("nan"), e) == "-"
    assert newswatch.fmt_value(200, {"digits": 0, "multiplier": 1, "unit": 0}) == "200K"
    assert newswatch.fmt_value(1.25, {"digits": 2, "multiplier": 3, "unit": 0}) == "1.25B"
    assert newswatch.fmt_value(1.5, {"digits": 99, "multiplier": 9, "unit": 77}) == "1.50000000"  # giống web: chỉ số ngoài bảng thì bỏ hậu tố


# --- SL / TP / lệnh chờ khớp -------------------------------------------------------------------------------------------------------------------------------

SYM = "XAUUSDm"


def deal(ticket, **kw):
    d = {"ticket": ticket, "order": ticket + 1000, "type": "sell", "entry": "out", "volume": 0.1, "price": 4001.2, "profit": -12.3, "commission": -0.5, "swap": 0.0, "time": T,
         "magic": 0, "position": 77, "sl": 0.0, "tp": 0.0, "symbol": SYM, "comment": "", "reason": "sl"}
    d.update(kw)
    return d


def pending(ticket, typ="buy_limit"):
    return {"ticket": ticket, "type": typ, "symbol": SYM, "volume": 0.2, "price_open": 4000.0}


class Trade:
    def __init__(self, cfg=None, now=T):
        self.now, self.out = now, []
        self.cfg = {**rules.DEFAULTS["trade"], "enabled": True, "channels": chans(web=True), **(cfg or {})}
        self.users = [("u1", self.cfg)]
        self.info = {"id": AID, "mode": "demo", "login": 123, "currency": "USD"}
        self.w = TradeWatcher(self.out.append, lambda: self.users, lambda aid: self.info, lambda: self.now)

    def deals(self, *ds):
        self.w.on_update(AID, "deals", {"deals": sorted(ds, key=lambda d: -d["time"])})

    def baseline(self):
        """Account chưa có deal nào từ lâu (hoặc lịch sử rỗng thật): mốc là 0, mọi deal sau đó là mới."""
        self.deals()
        self.now += tradewatch.BASELINE_WAIT + 1
        self.deals()

    def orders(self, *os):
        self.w.on_update(AID, "trade", {"orders": list(os), "positions": []})

    def restart(self):
        """Backend khởi động lại: bộ nhớ mất, bảng `trade_watch` còn."""
        self.w = TradeWatcher(self.out.append, lambda: self.users, lambda aid: self.info, lambda: self.now)


def test_history_is_only_a_baseline_then_new_sl_tp_and_stop_out_are_reported():
    t = Trade()
    t.deals(deal(10), deal(11, reason="tp"))  # lịch sử có sẵn lúc mới thấy account: không báo
    assert t.out == []
    t.deals(deal(10), deal(11, reason="tp"), deal(12, type="buy", reason="sl", price=4010.5, profit=5.0, commission=0.0))
    [f] = t.out
    assert f.kind == "trade" and f.alert["name"] == "SL hit" and f.alert["user_id"] == "u1" and f.alert["message"] == "Demo #123" and f.time == T
    assert f.line == "SELL 0.1 XAUUSDm closed at 4010.5 · P/L +5.00 USD · #77"  # deal mua đóng vị thế bán
    t.deals(deal(13, reason="tp", profit=30.0, commission=-0.5), deal(14, reason="so"))
    assert [x.alert["name"] for x in t.out] == ["SL hit", "TP hit", "Stop out"]
    assert t.out[1].line == "BUY 0.1 XAUUSDm closed at 4001.2 · P/L +29.50 USD · #77"
    t.deals(deal(13, reason="tp"), deal(14, reason="so"))
    assert len(t.out) == 3  # mỗi deal một lần


def test_history_that_arrives_after_an_empty_first_message_is_still_only_a_baseline():
    t = Trade()
    t.deals()  # terminal chưa nạp xong lịch sử: thông điệp đầu rỗng
    t.now += 5
    t.deals(deal(10, time=T - 3600), deal(11, reason="tp", time=T - 1800))  # lịch sử về: không phải deal mới
    assert t.out == []
    t.deals(deal(12), deal(10, time=T - 3600), deal(11, reason="tp", time=T - 1800))
    assert [f.alert["name"] for f in t.out] == ["SL hit"]


def test_an_account_that_really_has_no_history_still_gets_its_first_deal_reported():
    t = Trade()
    t.baseline()
    t.now += tradewatch.BASELINE_WAIT + 1  # lâu rồi vẫn rỗng: tài khoản thật sự chưa có deal
    t.baseline()
    t.deals(deal(1))
    assert [f.alert["name"] for f in t.out] == ["SL hit"]


def test_manual_closes_market_orders_and_balance_deals_are_not_reported():
    t = Trade()
    t.baseline()
    t.deals(deal(1, reason="client"), deal(2, reason="expert"), deal(3, entry="in", reason="client", order=3), deal(4, type="balance", reason=""), deal(5, reason="mobile"),
             deal(6, type="balance", entry="out", reason="sl"))  # nạp / rút tiền không phải sự kiện giao dịch dù trường khác trông như SL
    assert t.out == []


def test_pending_order_fill_is_recognised_whether_the_order_list_or_the_deal_arrives_first():
    t = Trade()
    t.baseline()
    t.orders(pending(555))
    t.orders()  # lệnh biến mất khỏi danh sách...
    t.deals(deal(20, entry="in", type="buy", reason="client", order=555, price=4000.0, volume=0.2, position=555))  # ...rồi deal tới
    assert t.out[-1].alert["name"] == "Pending order filled" and t.out[-1].line == "Buy limit 0.2 XAUUSDm filled at 4000 · #555"
    t.orders(pending(556, "sell_stop"))
    t.deals(deal(21, entry="in", type="sell", reason="client", order=556, price=3990.0, volume=0.2))  # deal tới trước khi danh sách lệnh đổi
    assert t.out[-1].line == "Sell stop 0.2 XAUUSDm filled at 3990 · #556"
    t.deals(deal(22, entry="in", type="buy", reason="client", order=999))  # lệnh thị trường: chưa từng là lệnh chờ
    assert len(t.out) == 2


def test_a_cancelled_order_reports_nothing():
    t = Trade()
    t.baseline()
    t.orders(pending(7))
    t.orders()
    assert t.out == []


def test_deals_that_happened_while_the_backend_was_off_are_reported_late_after_restart():
    t = Trade(now=T)
    t.deals(deal(10))
    t.orders(pending(555))
    t.restart()
    t.now = T + 7200
    t.deals(deal(10), deal(11, reason="tp", time=T + 3000), deal(12, entry="in", type="buy", reason="client", order=555, time=T + 4000, position=555))
    assert [f.line.startswith("(trễ) ") for f in t.out] == [True, True]
    assert [f.alert["name"] for f in t.out] == ["TP hit", "Pending order filled"]
    t.restart()
    t.deals(deal(11, reason="tp", time=T + 3000))
    assert len(t.out) == 2  # mốc đã nhớ: không báo lại


def test_a_fresh_deal_is_not_marked_late():
    t = Trade()
    t.baseline()
    t.now = T + 60
    t.deals(deal(1, time=T + 30))
    assert not t.out[0].line.startswith("(trễ)")


def test_seeing_the_orders_first_does_not_turn_old_history_into_a_flood_after_restart():
    t = Trade()
    t.orders(pending(1))  # chưa từng thấy deal nào: mốc deal để NULL, không phải 0
    t.restart()
    t.deals(deal(5), deal(6, reason="tp"))
    assert t.out == []


def test_deals_older_than_a_day_are_dropped():
    t = Trade()
    t.baseline()
    t.now = T + 3 * 86400
    t.deals(deal(1, time=T + 10))
    assert t.out == []


def test_baseline_advances_even_with_no_rule_so_enabling_later_gives_no_backlog():
    t = Trade()
    t.users = []
    t.baseline()
    t.deals(deal(1))
    assert t.out == []
    t.users = [("u1", t.cfg)]
    t.deals(deal(1))
    assert t.out == []
    t.deals(deal(1), deal(2))
    assert len(t.out) == 1


def test_rule_flags_choose_the_events_and_stop_out_is_always_reported():
    t = Trade({"sl": False, "tp": True, "fill": False})
    t.baseline()
    t.orders(pending(9))
    t.orders()
    t.deals(deal(1, reason="sl"), deal(2, reason="tp"), deal(3, reason="so"), deal(4, entry="in", type="buy", reason="client", order=9))
    assert [f.alert["name"] for f in t.out] == ["TP hit", "Stop out"]


def test_many_events_in_one_batch_merge_into_one_notice():
    t = Trade()
    t.baseline()
    t.deals(*[deal(i, reason="so", position=i) for i in range(1, 6)])
    [f] = t.out
    assert f.alert["name"] == "5 trade events" and f.line.count("\n") == 4


def test_each_enabled_user_is_notified_through_their_own_channels():
    t = Trade()
    t.users = [("u1", {**t.cfg, "channels": chans(web=True)}), ("u2", {**t.cfg, "channels": chans(telegram=True)})]
    t.baseline()
    t.deals(deal(1))
    assert {f.alert["user_id"]: f.alert["channels"] for f in t.out} == {"u1": chans(web=True), "u2": chans(telegram=True)}


def test_registry_calls_the_listener_when_the_ea_reports():
    seen = []
    reg = mt5.Mt5Registry()
    reg.listeners.append(lambda aid, mtype, t: seen.append((aid, mtype, len(t["deals"]), len(t["orders"]))))

    class W:
        pass

    w = W()
    reg.register(w, {"server": "S", "login": 5})
    reg.update_trade(w, {"type": "trade", "positions": [], "orders": [{"ticket": 1, "symbol": SYM, "type": "buy_limit"}]})
    reg.update_trade(w, {"type": "deals", "deals": [{"ticket": 2, "symbol": SYM, "type": "buy", "entry": "in"}]})
    reg.update_trade(w, {"type": "ping"})
    assert seen == [("S:5", "trade", 0, 1), ("S:5", "deals", 1, 1)]
    reg.listeners.append(lambda *a: 1 / 0)  # người nghe lỗi không làm hỏng EA
    reg.update_trade(w, {"type": "deals", "deals": []})
