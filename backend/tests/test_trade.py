import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import accounts, auth, mt5, state, tcp_server, trade
from app.config import EA_TOKEN
from app.main import app

ORIGIN = {"Origin": "http://localhost:3000"}
HELLO = {"server": "Exness-MT5Trial17", "broker": "Exness Technologies Ltd", "login": 12345678, "name": "Trong", "mode": "demo",
         "currency": "USD", "leverage": 500}
AID = "Exness-MT5Trial17:12345678"
XAU = {"name": "XAUUSDm", "digits": 3, "tick_size": 0.001, "type": "metal", "volume_min": 0.01, "volume_max": 100, "volume_step": 0.01}
OK = {"type": "trade_result", "ok": True, "retcode": 10009, "reason": "", "comment": "Request executed", "order": 555, "deal": 777,
      "price": 4131.25, "volume": 0.1}
CID = "click-0001-abcd"


@pytest.fixture(autouse=True)
def clean():
    mt5.registry.clear()
    state.meta.put("settings", "broker", "", {"name": HELLO["broker"], "server": HELLO["server"]})
    state.symbols["XAUUSDm"] = dict(XAU)
    with auth.store.meta.tx() as db:
        db.execute("DELETE FROM sessions")
        db.execute("DELETE FROM users")
        db.execute("DELETE FROM orders_log")
    auth.throttle.fails.clear()
    trade.broker.__init__(trade.broker.log)  # trạng thái sạch: không nhớ client_id / busy / bộ đếm của test trước
    real = accounts.PBKDF2_ITER
    accounts.PBKDF2_ITER = 1_000
    yield
    accounts.PBKDF2_ITER = real
    state.symbols.pop("XAUUSDm", None)
    mt5.registry.clear()


class FakeEA:
    """Writer giả của một EA: ghi lại lệnh nhận được; `answer` (nếu có) trả lời ngay như EA thật (qua event loop)."""

    def __init__(self, answer=None):
        self.sent = []
        self.answer = answer

    def write(self, data: bytes) -> None:
        msg = json.loads(data)
        self.sent.append(msg)
        if self.answer is not None:
            res = self.answer(msg)
            if res is not None:
                asyncio.get_running_loop().call_soon(trade.broker.resolve, {**res, "req_id": msg["req_id"]}, AID)

    async def drain(self) -> None:
        pass


def online(ea, **info):
    aid = mt5.registry.register(ea, HELLO)
    mt5.registry.update(ea, {"ea_trading": True, "max_lot": 1.0, "trade_allowed": True, "terminal_trade_allowed": True, **info})
    return aid


def logged_in():
    c = TestClient(app, headers=ORIGIN)
    assert c.post("/auth/register", json={"email": "t@example.com", "password": "correct horse"}).status_code == 201
    return c


def order(**kw):
    return {"symbol": "XAUUSDm", "side": "buy", "volume": 0.1, "sl": 4120.5, "tp": 4150, "client_id": CID, **kw}


# --- registry: trường mới của account message ------------------------------------------------------------------------------
def test_account_message_keeps_trading_flags_and_ignores_junk():
    r = mt5.Mt5Registry()
    w = object()
    r.register(w, HELLO)
    r.update(w, {"ea_trading": True, "max_lot": 0.5, "ea_version": "2.12"})
    a = r.info(AID)
    assert a["ea_trading"] is True and a["max_lot"] == 0.5 and a["ea_version"] == "2.12"
    r.update(w, {"ea_trading": "yes", "max_lot": float("nan"), "ea_version": 12})
    assert r.info(AID)["ea_trading"] is True and r.info(AID)["max_lot"] == 0.5 and r.info(AID)["ea_version"] == "2.12"
    assert r.writer(AID) is w and r.account_of(w) == AID
    r.remove(w)
    assert r.writer(AID) is None


def test_symbols_in_keep_trade_specs_and_old_ea_has_none():
    from app.models import SymbolInfo

    new = SymbolInfo(name="X", volume_min=0.01, volume_max=50, volume_step=0.01, contract_size=100, stops_level=10, freeze_level=0).model_dump()
    assert new["volume_step"] == 0.01 and new["stops_level"] == 10
    old = SymbolInfo(name="X").model_dump()
    assert old["volume_min"] is None and old["volume_step"] is None  # EA < 2.12: không đoán


# --- cổng của endpoint ------------------------------------------------------------------------------------------------------
def test_orders_need_login():
    c = TestClient(app, headers=ORIGIN)
    online(FakeEA())
    assert c.post(f"/accounts/{AID}/orders", json=order()).status_code == 401
    assert c.delete(f"/accounts/{AID}/positions/5").status_code == 401


def test_gates_refuse_before_anything_is_sent():
    c = logged_in()
    ea = FakeEA(lambda m: OK)
    assert c.post("/accounts/nope/orders", json=order()).status_code == 404  # account lạ

    aid = online(ea)
    mt5.registry.remove(ea)
    r = c.post(f"/accounts/{aid}/orders", json=order())
    assert r.status_code == 409 and "offline" in r.json()["detail"]

    ea2 = FakeEA(lambda m: OK)
    mt5.registry.clear()
    mt5.registry.register(ea2, {**HELLO, "mode": "real"})
    r = c.post(f"/accounts/{aid}/orders", json=order())
    assert r.status_code == 403 and "demo" in r.json()["detail"]  # real/contest/unknown không được

    for mode in ("contest", ""):
        mt5.registry.clear()
        mt5.registry.register(ea2, {**HELLO, "mode": mode})
        assert c.post(f"/accounts/{aid}/orders", json=order()).status_code == 403

    for flags, text in (({"ea_trading": False}, "TradingEnabled"), ({"terminal_trade_allowed": False}, "AutoTrading"), ({"trade_allowed": False}, "investor")):
        mt5.registry.clear()
        online(ea2, **flags)
        r = c.post(f"/accounts/{aid}/orders", json=order())
        assert r.status_code == 409 and text in r.json()["detail"], flags

    mt5.registry.clear()
    ea3 = FakeEA(lambda m: OK)
    mt5.registry.register(ea3, HELLO)  # EA cũ chưa báo ea_trading: coi như chưa bật
    assert c.post(f"/accounts/{aid}/orders", json=order()).status_code == 409
    assert ea.sent == [] and ea2.sent == [] and ea3.sent == []  # không lệnh nào xuống EA


def test_body_and_volume_validation():
    c = logged_in()
    ea = FakeEA(lambda m: OK)
    aid = online(ea)
    url = f"/accounts/{aid}/orders"
    for bad in (order(side="hold"), order(volume=0), order(volume=-1), order(sl=-1), order(client_id="x"), order(client_id="a b c d e f g h"), order(symbol="")):
        assert c.post(url, json=bad).status_code == 422, bad
    assert c.post(url, content=b'{"symbol":"XAUUSDm","side":"buy","volume":NaN,"client_id":"%s"}' % CID.encode(), headers={"Content-Type": "application/json"}).status_code == 422
    assert c.post(url, json=order(symbol="NOPE")).status_code == 404
    assert c.post(url, json=order(volume=0.005)).status_code == 422  # dưới min
    assert c.post(url, json=order(volume=0.015)).status_code == 422  # không phải bội của step
    assert c.post(url, json=order(volume=2)).status_code == 422  # vượt MaxLotPerOrder (1.0) của EA
    assert c.post(url, json=order(volume=1)).status_code == 200  # đúng giới hạn thì qua
    assert len(ea.sent) == 1


# --- đặt / đóng lệnh ----------------------------------------------------------------------------------------------------------
def test_market_order_roundtrip_and_orders_log():
    c = logged_in()
    ea = FakeEA(lambda m: OK)
    aid = online(ea)
    r = c.post(f"/accounts/{aid}/orders", json=order())
    body = r.json()
    assert r.status_code == 200 and body["ok"] is True and body["retcode"] == 10009 and body["deal"] == 777 and body["price"] == 4131.25
    [cmd] = ea.sent
    assert cmd["type"] == "order_send" and cmd["symbol"] == "XAUUSDm" and cmd["side"] == "buy" and cmd["volume"] == 0.1
    assert cmd["sl"] == 4120.5 and cmd["tp"] == 4150 and cmd["client_id"] == CID and len(cmd["req_id"]) == 32 and body["req_id"] == cmd["req_id"]
    [row] = trade.broker.log.rows()
    assert row["status"] == "ok" and row["account_id"] == aid and row["action"] == "order_send" and row["client_id"] == CID
    assert json.loads(row["request"])["volume"] == 0.1 and json.loads(row["result"])["deal"] == 777
    assert row["user_id"] == c.get("/auth/me").json()["user"]["id"]


def test_broker_rejection_is_ok_false_with_vietnamese_message():
    c = logged_in()
    ea = FakeEA(lambda m: {"type": "trade_result", "ok": False, "retcode": 10019, "reason": "rejected", "comment": "No money"})
    aid = online(ea)
    r = c.post(f"/accounts/{aid}/orders", json=order())
    assert r.status_code == 200 and r.json()["ok"] is False and r.json()["message"] == "Không đủ margin" and r.json()["retcode"] == 10019
    assert trade.broker.log.rows()[0]["status"] == "rejected"


@pytest.mark.parametrize("reason,text", [("ea_trading_off", "TradingEnabled"), ("real_blocked", "AllowRealAccount"), ("lot_over_limit", "MaxLotPerOrder"),
                                          ("no_position", "đã đóng"), ("terminal_trade_off", "AutoTrading")])
def test_ea_reasons_are_translated(reason, text):
    c = logged_in()
    aid = online(FakeEA(lambda m: {"type": "trade_result", "ok": False, "retcode": 0, "reason": reason}))
    j = c.post(f"/accounts/{aid}/orders", json=order()).json()
    assert j["ok"] is False and text in j["message"]


def test_unknown_retcode_shows_code_and_broker_comment():
    assert trade.result_message(False, 10099, "rejected", "Strange") == "Broker từ chối (mã 10099): Strange"
    assert trade.result_message(False, 10016, "rejected", "Invalid stops") == "SL/TP không hợp lệ (quá gần giá)"
    assert trade.result_message(True, 10009, "", "") == ""


def test_ok_is_only_true_for_done_codes_without_reason():
    for res in ({"ok": True, "retcode": 10019}, {"ok": True, "retcode": 10009, "reason": "x"}, {"ok": "true", "retcode": 10009}, {"retcode": 10009}):
        assert trade._clean_result(res)["ok"] is False, res
    assert trade._clean_result({"ok": True, "retcode": 10010})["ok"] is True
    junk = trade._clean_result({"ok": True, "retcode": 10009, "price": float("nan"), "order": "x", "comment": "c" * 500, "volume": True})
    assert junk["price"] == 0 and junk["order"] == 0 and junk["volume"] == 0 and len(junk["comment"]) == 120


def test_same_client_id_is_not_sent_twice():
    c = logged_in()
    ea = FakeEA(lambda m: OK)
    aid = online(ea)
    first = c.post(f"/accounts/{aid}/orders", json=order()).json()
    again = c.post(f"/accounts/{aid}/orders", json=order()).json()
    assert len(ea.sent) == 1 and again["duplicate"] is True and again["deal"] == first["deal"]
    assert c.post(f"/accounts/{aid}/orders", json=order(client_id="click-0002-abcd")).json().get("duplicate") is None  # cú bấm khác = lệnh mới
    assert len(ea.sent) == 2


def test_close_position_full_and_partial():
    c = logged_in()
    ea = FakeEA(lambda m: OK)
    aid = online(ea)
    assert c.delete(f"/accounts/{aid}/positions/111").json()["ok"] is True
    assert c.delete(f"/accounts/{aid}/positions/222?volume=0.05").json()["ok"] is True
    assert set(ea.sent[0]) == {"type", "ticket", "volume", "req_id"} and ea.sent[0]["type"] == "position_close"
    assert (ea.sent[0]["ticket"], ea.sent[0]["volume"]) == (111, 0) and (ea.sent[1]["ticket"], ea.sent[1]["volume"]) == (222, 0.05)
    assert c.delete(f"/accounts/{aid}/positions/0").status_code == 422
    assert c.delete(f"/accounts/{aid}/positions/5?volume=-1").status_code == 422
    assert c.delete(f"/accounts/{aid}/positions/abc").status_code == 422
    mt5.registry.clear()
    mt5.registry.register(FakeEA(), {**HELLO, "mode": "real"})
    assert c.delete(f"/accounts/{aid}/positions/111").status_code == 403  # đóng cũng chỉ demo (T2)


# --- chống gửi lặp / quá hạn / dồn dập ------------------------------------------------------------------------------------------
def test_timeout_keeps_unknown_then_late_result_is_recorded():
    async def run():
        trade.broker.timeout = 0.05
        ea = FakeEA()  # không trả lời
        aid = online(ea)
        cmd = {"type": "order_send", "symbol": "XAUUSDm", "side": "buy", "volume": 0.1, "sl": 0, "tp": 0, "client_id": CID}
        with pytest.raises(Exception) as e:
            await trade.broker.run(aid, ea, "u1", cmd, CID)
        assert e.value.status_code == 504 and "Positions" in e.value.detail
        req_id = ea.sent[0]["req_id"]
        assert trade.broker.log.rows()[0]["status"] == "unknown"
        with pytest.raises(Exception) as e:  # gửi lại cùng client_id: chưa biết kết quả nên chặn, không tạo lệnh thứ hai
            await trade.broker.run(aid, ea, "u1", cmd, CID)
        assert e.value.status_code == 409 and len(ea.sent) == 1
        # account không bị khoá vì lệnh treo: lệnh khác vẫn gửi được
        ea.answer = lambda m: OK
        res = await trade.broker.run(aid, ea, "u1", {**cmd, "client_id": "click-0002-abcd"}, "click-0002-abcd")
        assert res["ok"] is True and len(ea.sent) == 2
        # kết quả của lệnh đầu đến muộn: ghi log + nhớ để lần gửi lại trả kết quả cũ
        trade.broker.resolve({**OK, "req_id": req_id}, aid)
        assert trade.broker.log.rows()[0]["status"] == "ok"
        again = await trade.broker.run(aid, ea, "u1", cmd, CID)
        assert again["duplicate"] is True and again["deal"] == 777 and len(ea.sent) == 2

    asyncio.run(run())


def test_one_order_at_a_time_per_account():
    async def run():
        ea = FakeEA()
        aid = online(ea)
        mk = lambda n: {"type": "order_send", "symbol": "XAUUSDm", "side": "buy", "volume": 0.1, "sl": 0, "tp": 0, "client_id": f"click-000{n}-abcd"}
        first = asyncio.create_task(trade.broker.run(aid, ea, "u1", mk(1), "click-0001-abcd"))
        await asyncio.sleep(0.01)
        with pytest.raises(Exception) as e:
            await trade.broker.run(aid, ea, "u1", mk(2), "click-0002-abcd")
        assert e.value.status_code == 409 and len(ea.sent) == 1
        trade.broker.resolve({**OK, "req_id": ea.sent[0]["req_id"]}, aid)
        assert (await first)["ok"] is True
        ea.answer = lambda m: OK
        assert (await trade.broker.run(aid, ea, "u1", mk(3), "click-0003-abcd"))["ok"] is True  # xong rồi thì gửi tiếp được

    asyncio.run(run())


def test_cancelled_request_releases_the_account():
    async def run():
        ea = FakeEA()
        aid = online(ea)
        cmd = {"type": "position_close", "ticket": 5, "volume": 0}
        t = asyncio.create_task(trade.broker.run(aid, ea, "u1", cmd, None))
        await asyncio.sleep(0.01)
        t.cancel()
        with pytest.raises(asyncio.CancelledError):
            await t
        ea.answer = lambda m: OK
        assert (await trade.broker.run(aid, ea, "u1", cmd, None))["ok"] is True

    asyncio.run(run())


def test_rate_limit_per_account():
    async def run():
        now = [1000.0]
        trade.broker.clock = lambda: now[0]
        ea = FakeEA(lambda m: OK)
        aid = online(ea)
        cmd = {"type": "position_close", "ticket": 5, "volume": 0}
        for _ in range(trade.MAX_PER_MINUTE):
            await trade.broker.run(aid, ea, "u1", cmd, None)
        with pytest.raises(Exception) as e:
            await trade.broker.run(aid, ea, "u1", cmd, None)
        assert e.value.status_code == 429 and len(ea.sent) == trade.MAX_PER_MINUTE
        now[0] += 61
        await trade.broker.run(aid, ea, "u1", cmd, None)  # qua một phút thì gửi lại được

    asyncio.run(run())


def test_result_from_another_account_is_ignored():
    async def run():
        ea = FakeEA()
        aid = online(ea)
        task = asyncio.create_task(trade.broker.run(aid, ea, "u1", {"type": "position_close", "ticket": 5, "volume": 0}, None))
        await asyncio.sleep(0.01)
        req = ea.sent[0]["req_id"]
        trade.broker.resolve({**OK, "req_id": req}, "Other-Server:999")  # EA khác account tự nhận kết quả
        trade.broker.resolve({**OK, "req_id": req}, None)
        await asyncio.sleep(0.01)
        assert not task.done()
        trade.broker.resolve({**OK, "req_id": "khong-co"}, aid)
        trade.broker.resolve({"type": "trade_result"}, aid)
        trade.broker.resolve({**OK, "req_id": req}, aid)
        assert (await task)["ok"] is True

    asyncio.run(run())


def test_send_failure_does_not_leave_account_stuck():
    async def run():
        class Broken(FakeEA):
            def write(self, data):
                raise ConnectionResetError

        ea = Broken()
        aid = online(ea)
        cmd = {"type": "order_send", "symbol": "XAUUSDm", "side": "buy", "volume": 0.1, "sl": 0, "tp": 0, "client_id": CID}
        with pytest.raises(Exception) as e:
            await trade.broker.run(aid, ea, "u1", cmd, CID)
        assert e.value.status_code == 503
        ok = FakeEA(lambda m: OK)
        assert (await trade.broker.run(aid, ok, "u1", cmd, CID))["ok"] is True  # cùng client_id gửi lại được vì lần trước chưa tới EA

    asyncio.run(run())


# --- đầu-cuối: HTTP + socket TCP thật tới tcp_server ------------------------------------------------------------------------
def test_end_to_end_http_to_tcp_ea_and_back():
    async def run():
        server = await tcp_server.start_server(host="127.0.0.1", port=0)
        port = server.sockets[0].getsockname()[1]
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        send = lambda m: writer.write((json.dumps(m) + "\n").encode())
        send({"type": "hello", "token": EA_TOKEN, **HELLO})
        send({"type": "account", "balance": 1, "ea_trading": True, "max_lot": 1.0, "trade_allowed": True, "terminal_trade_allowed": True})
        await writer.drain()

        async def ea_loop():  # EA giả: trả lời mọi lệnh giao dịch như EA thật
            while True:
                line = await reader.readline()
                if not line:
                    return
                m = json.loads(line)
                if m["type"] == "order_send":
                    send({**OK, "req_id": m["req_id"]})
                elif m["type"] == "position_close":
                    send({"type": "trade_result", "req_id": m["req_id"], "ok": False, "retcode": 0, "reason": "no_position"})
                await writer.drain()

        ea_task = asyncio.create_task(ea_loop())
        for _ in range(100):
            if mt5.registry.info(AID) and mt5.registry.info(AID).get("ea_trading"):
                break
            await asyncio.sleep(0.02)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=ORIGIN) as c:
            assert (await c.post("/auth/register", json={"email": "e@example.com", "password": "correct horse"})).status_code == 201
            r = await c.post(f"/accounts/{AID}/orders", json=order())
            assert r.status_code == 200 and r.json()["ok"] is True and r.json()["deal"] == 777
            r = await c.delete(f"/accounts/{AID}/positions/42")
            assert r.json()["ok"] is False and "đã đóng" in r.json()["message"]
        assert [x["status"] for x in trade.broker.log.rows()] == ["ok", "rejected"]
        ea_task.cancel()
        writer.close()
        server.close()
        await server.wait_closed()

    asyncio.run(run())
