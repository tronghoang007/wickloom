import asyncio
import json
import time

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
    mt5.registry.update(ea, {"ea_trading": True, "max_lot": 1.0, "trade_allowed": True, "terminal_trade_allowed": True, "ea_version": "2.13", **info})
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


def test_writer_prefers_newest_connection_of_account():
    r = mt5.Mt5Registry()
    old, new = object(), object()
    r.register(old, HELLO)
    r.register(new, HELLO)  # EA nối lại trước khi kết nối cũ đóng
    assert r.writer(AID) is new
    r.remove(new)
    assert r.writer(AID) is old


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
        cmd = {"type": "order_send", "symbol": "XAUUSDm", "side": "buy", "volume": 0.1, "sl": 0, "tp": 0, "client_id": CID}
        for _ in range(trade.MAX_PER_MINUTE):
            await trade.broker.run(aid, ea, "u1", cmd, None)
        with pytest.raises(Exception) as e:
            await trade.broker.run(aid, ea, "u1", cmd, None)
        assert e.value.status_code == 429 and len(ea.sent) == trade.MAX_PER_MINUTE
        now[0] += 61
        await trade.broker.run(aid, ea, "u1", cmd, None)  # qua một phút thì gửi lại được

    asyncio.run(run())


def test_closing_and_cancelling_are_not_blocked_by_the_new_order_limit():
    """Chặn 20 lệnh MỚI/phút không được cản việc thoát: "Close all" / "Cancel all" với nhiều hơn 20 lệnh vẫn phải chạy hết; chỉ có trần riêng, cao hơn."""
    async def run():
        now = [1000.0]
        trade.broker.clock = lambda: now[0]
        ea = FakeEA(lambda m: OK)
        aid = online(ea)
        new = {"type": "order_send", "symbol": "XAUUSDm", "side": "buy", "volume": 0.1, "sl": 0, "tp": 0, "client_id": CID}
        for _ in range(trade.MAX_PER_MINUTE):
            await trade.broker.run(aid, ea, "u1", new, None)
        with pytest.raises(Exception) as e:
            await trade.broker.run(aid, ea, "u1", new, None)
        assert e.value.status_code == 429
        close = {"type": "position_close", "ticket": 5, "volume": 0}
        for _ in range(trade.MAX_PER_MINUTE + 10):  # đã hết hạn mức lệnh mới mà vẫn đóng được
            assert (await trade.broker.run(aid, ea, "u1", close, None))["ok"] is True
        for _ in range(trade.MAX_MANAGE_PER_MINUTE - trade.MAX_PER_MINUTE - 10):
            await trade.broker.run(aid, ea, "u1", {"type": "order_delete", "ticket": 6}, None)
        with pytest.raises(Exception) as e:  # nhưng vẫn có trần riêng
            await trade.broker.run(aid, ea, "u1", close, None)
        assert e.value.status_code == 429
        now[0] += 61
        await trade.broker.run(aid, ea, "u1", close, None)

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


# --- T3: lệnh chờ ---------------------------------------------------------------------------------------------------------------
def pending(**kw):
    return {"symbol": "XAUUSDm", "side": "buy", "volume": 0.1, "price": 4120.5, "sl": 4110, "tp": 4140, "client_id": CID, "expected_type": "buy_limit", **kw}


def placed(otype="buy_limit", **kw):
    return {**OK, "order_type": otype, "deal": 0, "retcode": 10009, **kw}


def test_pending_order_sends_intent_and_reports_type():
    c = logged_in()
    ea = FakeEA(lambda m: placed())
    aid = online(ea)
    r = c.post(f"/accounts/{aid}/orders", json=pending()).json()
    assert r["ok"] is True and r["order_type"] == "buy_limit" and r["type_changed"] is False
    [cmd] = ea.sent
    # web chỉ gửi ý định (hướng + giá): KHÔNG gửi loại lệnh, EA tự quyết lúc thực thi
    assert cmd["type"] == "order_pending" and cmd["side"] == "buy" and cmd["price"] == 4120.5 and cmd["sl"] == 4110 and cmd["tp"] == 4140
    assert cmd["expected_type"] == "buy_limit" and cmd["expiration"] == 0 and "order_type" not in cmd and "type" in cmd


def test_price_jump_changes_the_type_and_is_flagged():
    c = logged_in()
    ea = FakeEA(lambda m: placed("buy_stop"))  # giá nhảy: Buy Limit biến thành Buy Stop
    aid = online(ea)
    r = c.post(f"/accounts/{aid}/orders", json=pending()).json()
    assert r["ok"] is True and r["order_type"] == "buy_stop" and r["type_changed"] is True
    # không có expected_type thì không có gì để so
    r2 = c.post(f"/accounts/{aid}/orders", json=pending(expected_type=None, client_id="click-0002-abcd")).json()
    assert r2["type_changed"] is False


def test_type_changed_rejection_names_the_new_type():
    c = logged_in()
    aid = online(FakeEA(lambda m: {"type": "trade_result", "ok": False, "retcode": 0, "reason": "type_changed", "order_type": "buy_stop"}))
    r = c.post(f"/accounts/{aid}/orders", json=pending()).json()
    assert r["ok"] is False and "Buy stop" in r["message"] and r["order_type"] == "buy_stop" and r["type_changed"] is True


def test_too_close_message_carries_the_stops_level():
    assert "tối thiểu 30 điểm" in trade.result_message(False, 0, "too_close", "30")
    assert trade.result_message(False, 0, "too_close", "0") == trade.REASONS["too_close"]
    assert trade.result_message(False, 0, "too_close", "abc") == trade.REASONS["too_close"]
    assert "Sell limit" in trade.result_message(False, 0, "type_would_change", "", "sell_limit")
    assert trade.result_message(False, 0, "no_order", "") == trade.REASONS["no_order"]


def test_pending_validation():
    c = logged_in()
    ea = FakeEA(lambda m: placed())
    aid = online(ea)
    url = f"/accounts/{aid}/orders"
    assert c.post(url, json=pending(price=0)).status_code == 422
    assert c.post(url, json=pending(price=-1)).status_code == 422
    assert c.post(url, json=pending(expected_type="sell_limit")).status_code == 422  # trái hướng
    assert c.post(url, json=pending(expected_type="buy_stop_limit")).status_code == 422
    assert c.post(url, json=pending(expiration=int(time.time()) - 5)).status_code == 422  # hết hạn trong quá khứ
    assert c.post(url, json=pending(expiration=int(time.time()) + 30)).status_code == 422  # sát hiện tại
    assert c.post(url, json=pending(volume=2)).status_code == 422  # MaxLotPerOrder
    assert c.post(url, json=order(expected_type="buy_limit")).status_code == 422  # lệnh market không có expected_type
    assert c.post(url, json=order(expiration=int(time.time()) + 9999)).status_code == 422
    assert ea.sent == []
    assert c.post(url, json=pending(expiration=int(time.time()) + 3600)).status_code == 200
    assert ea.sent[0]["expiration"] > time.time()


def test_pending_is_demo_only_like_market():
    c = logged_in()
    ea = FakeEA(lambda m: placed())
    aid = online(ea)
    mt5.registry.clear()
    mt5.registry.register(ea, {**HELLO, "mode": "real"})
    assert c.post(f"/accounts/{aid}/orders", json=pending()).status_code == 403
    assert c.patch(f"/accounts/{aid}/orders/5", json={"price": 1}).status_code == 403
    assert c.delete(f"/accounts/{aid}/orders/5").status_code == 403
    assert ea.sent == []


def known_order(ea, **kw):
    mt5.registry.update_trade(ea, {"type": "trade", "positions": [], "orders": [{
        "ticket": 222, "symbol": "XAUUSDm", "type": "buy_limit", "volume": 0.2, "price_open": 4110.0, "price_stoplimit": 0, "sl": 4100.0, "tp": 4140.0,
        "time_setup": 1_700_000_000, "expiration": 0, "magic": 0, "comment": "", **kw}]})


def test_modify_merges_with_the_known_order():
    c = logged_in()
    ea = FakeEA(lambda m: placed())
    aid = online(ea)
    known_order(ea)
    url = f"/accounts/{aid}/orders/222"
    assert c.patch(url, json={"price": 4112.5}).json()["ok"] is True
    cmd = ea.sent[0]
    assert cmd["type"] == "order_modify" and cmd["ticket"] == 222 and cmd["price"] == 4112.5 and cmd["sl"] == 4100.0 and cmd["tp"] == 4140.0 and cmd["expiration"] == 0
    c.patch(url, json={"sl": 0, "tp": 4150})  # sl = 0 là bỏ SL (khác với vắng mặt = giữ nguyên)
    cmd = ea.sent[1]
    assert cmd["price"] == 4110.0 and cmd["sl"] == 0 and cmd["tp"] == 4150


def test_modify_validation():
    c = logged_in()
    ea = FakeEA(lambda m: placed())
    aid = online(ea)
    known_order(ea)
    assert c.patch(f"/accounts/{aid}/orders/222", json={}).status_code == 422  # không có gì để sửa
    assert c.patch(f"/accounts/{aid}/orders/999", json={"price": 1}).status_code == 404  # không có lệnh này
    assert c.patch(f"/accounts/{aid}/orders/0", json={"price": 1}).status_code == 422
    assert c.patch(f"/accounts/{aid}/orders/222", json={"price": -3}).status_code == 422
    assert c.patch(f"/accounts/{aid}/orders/222", json={"sl": -1}).status_code == 422
    assert c.patch(f"/accounts/{aid}/orders/222", json={"expiration": int(time.time()) - 1000}).status_code == 422
    assert c.patch(f"/accounts/{aid}/orders/abc", json={"price": 1}).status_code == 422
    assert ea.sent == []
    assert c.patch(f"/accounts/{aid}/orders/222", json={"expiration": int(time.time()) + 3600}).status_code == 200


def test_modify_that_would_change_type_is_refused_by_the_ea():
    c = logged_in()
    aid = online(FakeEA(lambda m: {"type": "trade_result", "ok": False, "retcode": 0, "reason": "type_would_change", "order_type": "buy_stop"}))
    known_order(next(iter(mt5.registry._by_writer)))
    r = c.patch(f"/accounts/{aid}/orders/222", json={"price": 4200}).json()
    assert r["ok"] is False and "Buy stop" in r["message"]


def test_delete_order():
    c = logged_in()
    ea = FakeEA(lambda m: placed(deal=0))
    aid = online(ea)
    assert c.delete(f"/accounts/{aid}/orders/222").json()["ok"] is True
    assert ea.sent[0]["type"] == "order_delete" and ea.sent[0]["ticket"] == 222
    assert c.delete(f"/accounts/{aid}/orders/0").status_code == 422
    assert c.delete(f"/accounts/{aid}/orders/abc").status_code == 422
    mt5.registry.clear()
    bad = online(FakeEA(lambda m: {"type": "trade_result", "ok": False, "retcode": 0, "reason": "no_order"}))
    assert "đã khớp hoặc bị huỷ" in c.delete(f"/accounts/{bad}/orders/222").json()["message"]


def test_pending_commands_are_logged_with_their_action():
    c = logged_in()
    ea = FakeEA(lambda m: placed())
    aid = online(ea)
    known_order(ea)
    c.post(f"/accounts/{aid}/orders", json=pending())
    c.patch(f"/accounts/{aid}/orders/222", json={"price": 4111})
    c.delete(f"/accounts/{aid}/orders/222")
    assert [r["action"] for r in trade.broker.log.rows()] == ["order_pending", "order_modify", "order_delete"]


def test_old_ea_cannot_take_pending_commands_but_market_still_works():
    c = logged_in()
    ea = FakeEA(lambda m: placed())
    aid = online(ea, ea_version="2.12")
    known_order(ea)
    for call in (lambda: c.post(f"/accounts/{aid}/orders", json=pending()), lambda: c.patch(f"/accounts/{aid}/orders/222", json={"price": 4111}),
                 lambda: c.delete(f"/accounts/{aid}/orders/222")):
        r = call()
        assert r.status_code == 409 and "2.13" in r.json()["detail"] and "2.12" in r.json()["detail"]
    assert ea.sent == []  # không gửi lệnh EA không hiểu rồi chờ 10s
    assert c.post(f"/accounts/{aid}/orders", json=order()).status_code == 200  # market chạy từ 2.12
    mt5.registry.clear()
    online(FakeEA(lambda m: placed()), ea_version="")  # không báo version
    assert c.post(f"/accounts/{aid}/orders", json=pending(client_id="click-0009-abcd")).status_code == 409
    assert trade._version("2.13") > trade._version("2.9") and trade._version("garbage") == ()


# --- T4: SL/TP của vị thế -------------------------------------------------------------------------------------------------------
def known_position(ea, **kw):
    mt5.registry.update_trade(ea, {"type": "trade", "orders": [], "positions": [{
        "ticket": 111, "symbol": "XAUUSDm", "type": "buy", "volume": 0.1, "price_open": 4125.0, "sl": 4115.0, "tp": 4145.0, "price_current": 4130.0,
        "profit": 50.0, "swap": 0, "time": 1_700_000_000, "magic": 0, "comment": "", **kw}]})


def test_position_sltp_merges_with_the_known_position():
    c = logged_in()
    ea = FakeEA(lambda m: placed())
    aid = online(ea, ea_version="2.14")
    known_position(ea)
    url = f"/accounts/{aid}/positions/111"
    assert c.patch(url, json={"sl": 4118.5}).json()["ok"] is True
    cmd = ea.sent[0]
    assert cmd["type"] == "position_modify" and cmd["ticket"] == 111 and cmd["sl"] == 4118.5 and cmd["tp"] == 4145.0  # TP giữ nguyên
    c.patch(url, json={"tp": 0})  # 0 = bỏ TP
    assert ea.sent[1]["sl"] == 4115.0 and ea.sent[1]["tp"] == 0


def test_position_sltp_validation_and_gates():
    c = logged_in()
    ea = FakeEA(lambda m: placed())
    aid = online(ea, ea_version="2.14")
    known_position(ea)
    url = f"/accounts/{aid}/positions/111"
    assert c.patch(url, json={}).status_code == 422
    assert c.patch(url, json={"sl": -1}).status_code == 422
    assert c.patch(f"/accounts/{aid}/positions/999", json={"sl": 1}).status_code == 404  # không có vị thế này
    assert c.patch(f"/accounts/{aid}/positions/0", json={"sl": 1}).status_code == 422
    assert c.patch(f"/accounts/{aid}/positions/abc", json={"sl": 1}).status_code == 422
    assert ea.sent == []
    mt5.registry.clear()
    old = FakeEA(lambda m: placed())
    online(old, ea_version="2.13")  # EA cũ không hiểu position_modify
    known_position(old)
    r = c.patch(url, json={"sl": 4118})
    assert r.status_code == 409 and "2.14" in r.json()["detail"] and old.sent == []
    mt5.registry.clear()
    real = FakeEA(lambda m: placed())
    mt5.registry.register(real, {**HELLO, "mode": "real"})
    assert c.patch(url, json={"sl": 4118}).status_code == 403


def test_position_sltp_rejections_are_translated():
    c = logged_in()
    aid = online(FakeEA(lambda m: {"type": "trade_result", "ok": False, "retcode": 0, "reason": "bad_stops"}), ea_version="2.14")
    known_position(next(iter(mt5.registry._by_writer)))
    r = c.patch(f"/accounts/{aid}/positions/111", json={"sl": 4140}).json()
    assert r["ok"] is False and "đúng phía" in r["message"]


def test_symbol_tick_values_are_kept():
    from app.models import SymbolInfo

    assert SymbolInfo(name="X", tick_value=0.1, tick_value_loss=0.1).model_dump()["tick_value"] == 0.1
    assert SymbolInfo(name="X").model_dump()["tick_value"] is None  # EA < 2.14: web không đoán lãi/lỗi
