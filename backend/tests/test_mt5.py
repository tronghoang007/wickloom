import asyncio
import json
import time

import pytest
from fastapi.testclient import TestClient

from app import accounts, auth, mt5, state, tcp_server
from app.config import EA_TOKEN
from app.main import app

ORIGIN = {"Origin": "http://localhost:3000"}
HELLO = {"server": "Exness-MT5Trial17", "broker": "Exness Technologies Ltd", "login": 12345678, "name": "Trong", "mode": "demo",
         "currency": "USD", "leverage": 500}


@pytest.fixture(autouse=True)
def clean():
    mt5.registry.clear()
    # cùng server với HELLO: handle_ea không archive bar cache (resync) khi đổi nguồn, chạy lẫn test khác không đụng nhau
    state.meta.put("settings", "broker", "", {"name": HELLO["broker"], "server": HELLO["server"]})
    with auth.store.meta.tx() as db:
        db.execute("DELETE FROM sessions")
        db.execute("DELETE FROM users")
        for t in accounts.USER_TABLES:
            db.execute(f"DELETE FROM {t}")
    auth.throttle.fails.clear()
    real = accounts.PBKDF2_ITER
    accounts.PBKDF2_ITER = 1_000
    yield
    accounts.PBKDF2_ITER = real
    mt5.registry.clear()


class W:  # writer giả: chỉ cần là khoá hashable
    pass


def test_register_parses_hello_and_old_ea_has_no_login():
    r = mt5.Mt5Registry(clock=lambda: 100.0)
    w = W()
    assert r.register(w, HELLO) == "Exness-MT5Trial17:12345678"
    [a] = r.snapshot()
    assert a == {
        "id": "Exness-MT5Trial17:12345678", "server": "Exness-MT5Trial17", "broker": "Exness Technologies Ltd", "login": 12345678,
        "name": "Trong", "mode": "demo", "currency": "USD", "leverage": 500, "seen": 100.0, "online": True, "active": True,
    }
    old = W()  # EA < 2.10: chỉ broker + server
    assert r.register(old, {"server": "Other-Server", "broker": "B"}) == "Other-Server"
    other = next(x for x in r.snapshot() if x["id"] == "Other-Server")
    assert other["login"] is None and other["mode"] == "unknown" and other["leverage"] is None
    assert r.register(W(), {}) is None  # không có gì để nhận diện


def test_mode_login_and_strings_are_sanitized():
    r = mt5.Mt5Registry()
    r.register(W(), {"server": "S", "login": -5, "mode": "<script>", "name": 7, "currency": "USDXXXXXXXXXX", "leverage": float("nan")})
    [a] = r.snapshot()
    assert a["login"] is None and a["mode"] == "unknown" and a["name"] == "" and a["currency"] == "USDXXXXX" and a["leverage"] is None
    r.register(W(), {"server": "S2", "name": "x" * 500, "login": True})
    b = next(x for x in r.snapshot() if x["id"] == "S2")
    assert len(b["name"]) == 100 and b["login"] is None  # bool không phải số


def test_update_keeps_valid_numbers_only_and_needs_registration():
    r = mt5.Mt5Registry()
    w = W()
    r.update(w, {"balance": 1})  # chưa đăng ký: bỏ qua
    assert r.snapshot() == []
    r.register(w, HELLO)
    r.update(w, {"balance": 10000.5, "equity": "abc", "margin_free": float("inf"), "profit": -12.25})
    [a] = r.snapshot()
    assert a["balance"] == 10000.5 and a["profit"] == -12.25 and "equity" not in a and "margin_free" not in a
    r.update(w, {"equity": 10001})
    assert r.snapshot()[0]["equity"] == 10001 and r.snapshot()[0]["balance"] == 10000.5  # số cũ giữ nguyên


def test_offline_keeps_last_info_and_online_sorts_first():
    now = [0.0]
    r = mt5.Mt5Registry(clock=lambda: now[0])
    a, b = W(), W()
    r.register(a, HELLO)
    r.update(a, {"balance": 5})
    now[0] = 10
    r.register(b, {**HELLO, "login": 999, "mode": "real"})
    r.remove(a)  # account đầu offline
    snap = r.snapshot()
    assert [x["id"] for x in snap] == ["Exness-MT5Trial17:999", "Exness-MT5Trial17:12345678"]
    assert [x["online"] for x in snap] == [True, False]
    assert snap[1]["balance"] == 5  # vẫn nhớ số dư lần cuối
    r.remove(b)
    assert [x["online"] for x in r.snapshot()] == [False, False]
    assert r.snapshot()[0]["id"].endswith(":999")  # offline thì account thấy gần nhất đứng đầu/active


def test_new_account_replaces_the_old_offline_one():
    # đổi login trong cùng cửa sổ MT5: kết nối EA cũ đóng trước, hello của account mới đến sau → account cũ (hoặc đã xoá khỏi MT5) không nằm lại trong danh sách
    r = mt5.Mt5Registry()
    old, new = W(), W()
    r.register(old, {**HELLO, "login": 111})
    r.update(old, {"balance": 5})
    r.update_trade(old, {"type": "trade", "positions": [], "orders": []})
    r.remove(old)
    assert [a["online"] for a in r.snapshot()] == [False]  # chưa có account nào khác: vẫn hiện offline
    r.register(new, {**HELLO, "login": 222})
    assert [a["id"] for a in r.snapshot()] == ["Exness-MT5Trial17:222"]
    assert r.trade("Exness-MT5Trial17:111") is None
    assert r.info("Exness-MT5Trial17:111") is None


def test_other_account_still_online_is_kept():
    r = mt5.Mt5Registry()
    a, b = W(), W()
    r.register(a, {**HELLO, "login": 111})
    r.register(b, {**HELLO, "login": 222})
    assert sorted(x["id"] for x in r.snapshot()) == ["Exness-MT5Trial17:111", "Exness-MT5Trial17:222"]


def test_reconnect_same_account_updates_in_place():
    r = mt5.Mt5Registry()
    w1 = W()
    r.register(w1, HELLO)
    r.update(w1, {"balance": 1})
    r.remove(w1)
    w2 = W()
    r.register(w2, {**HELLO, "mode": "real"})
    snap = r.snapshot()
    assert len(snap) == 1 and snap[0]["online"] and snap[0]["mode"] == "real" and snap[0]["balance"] == 1


def test_accounts_endpoint_needs_login():
    c = TestClient(app, headers=ORIGIN)
    assert c.get("/accounts").status_code == 401  # có số dư: khách không xem được
    mt5.registry.register(W(), HELLO)
    assert c.get("/accounts").status_code == 401
    assert c.post("/auth/register", json={"email": "u@example.com", "password": "correct horse"}).status_code == 201
    body = c.get("/accounts").json()
    assert body["switchable"] is False
    assert [a["id"] for a in body["accounts"]] == ["Exness-MT5Trial17:12345678"]
    assert "password" not in json.dumps(body).lower()


def test_tcp_ea_connection_registers_updates_and_goes_offline():
    async def run():
        server = await tcp_server.start_server(host="127.0.0.1", port=0)
        port = server.sockets[0].getsockname()[1]
        reader, writer = await asyncio.open_connection("127.0.0.1", port)

        async def wait(pred):
            for _ in range(100):
                if pred():
                    return True
                await asyncio.sleep(0.02)
            return False

        send = lambda m: writer.write((json.dumps(m) + "\n").encode())
        send({"type": "hello", "token": EA_TOKEN, **HELLO})
        send({"type": "account", "balance": 10000, "equity": 10010.5, "margin_free": 9000, "profit": 10.5})
        send({"type": "ping"})
        await writer.drain()
        assert await wait(lambda: mt5.registry.snapshot() and mt5.registry.snapshot()[0].get("equity") == 10010.5)
        [a] = mt5.registry.snapshot()
        assert a["online"] and a["mode"] == "demo" and a["login"] == 12345678 and a["balance"] == 10000
        writer.close()
        assert await wait(lambda: not mt5.registry.snapshot()[0]["online"])
        assert mt5.registry.snapshot()[0]["balance"] == 10000  # offline vẫn nhớ
        server.close()
        await server.wait_closed()

    asyncio.run(run())


def test_bad_token_does_not_register():
    async def run():
        server = await tcp_server.start_server(host="127.0.0.1", port=0)
        port = server.sockets[0].getsockname()[1]
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write((json.dumps({"type": "hello", "token": "wrong", **HELLO}) + "\n").encode())
        writer.write_eof()
        await writer.drain()
        await reader.read()
        writer.close()
        server.close()
        await server.wait_closed()

    asyncio.run(run())
    assert mt5.registry.snapshot() == []


# --- T1: trạng thái giao dịch chỉ đọc -------------------------------------------------------------------------------------
POS = {"ticket": 111, "symbol": "XAUUSDm", "type": "buy", "volume": 0.1, "price_open": 4100.5, "sl": 4090, "tp": 4120, "price_current": 4105.25,
       "profit": 47.5, "swap": -0.3, "time": 1_700_000_000, "magic": 7, "comment": "tay"}
ORD = {"ticket": 222, "symbol": "EURUSD", "type": "sell_limit", "volume": 0.2, "price_open": 1.1, "price_stoplimit": 0, "sl": 0, "tp": 0,
       "time_setup": 1_700_000_100, "expiration": 0, "magic": 0, "comment": ""}
DEAL = {"ticket": 333, "order": 111, "symbol": "XAUUSDm", "type": "buy", "entry": "in", "volume": 0.1, "price": 4100.5, "profit": 0, "commission": -0.7,
        "swap": 0, "time": 1_700_000_000, "magic": 7, "comment": ""}


def registered():
    r = mt5.Mt5Registry(clock=lambda: 50.0)
    w = W()
    r.register(w, HELLO)
    return r, w


def test_trade_message_replaces_positions_and_orders():
    r, w = registered()
    assert r.trade("Exness-MT5Trial17:12345678")["updated_at"] is None  # chưa nhận gì
    r.update_trade(w, {"type": "trade", "positions": [POS], "orders": [ORD]})
    t = r.trade("Exness-MT5Trial17:12345678")
    assert t["positions"] == [POS] and t["orders"] == [ORD] and t["updated_at"] == 50.0 and t["deals"] == []
    r.update_trade(w, {"type": "trade", "positions": [], "orders": [ORD]})  # lệnh đóng → danh sách mới thay thế hẳn
    assert r.trade("Exness-MT5Trial17:12345678")["positions"] == []
    assert t["account"]["id"] == "Exness-MT5Trial17:12345678"


def test_trade_rows_are_sanitized_and_capped():
    r, w = registered()
    junk = [{"ticket": 0, "symbol": "X", "type": "buy"}, {"ticket": 5, "symbol": "", "type": "buy"}, "x", None, {"ticket": 6, "symbol": "S", "type": "<b>",
            "volume": float("nan"), "profit": "abc", "comment": "c" * 200, "evil": "drop me"}]
    r.update_trade(w, {"type": "trade", "positions": junk, "orders": "không phải list"})
    t = r.trade("Exness-MT5Trial17:12345678")
    assert t["orders"] == [] and len(t["positions"]) == 1  # ticket 0, symbol rỗng, không phải dict bị bỏ
    p = t["positions"][0]
    assert p["type"] == "other" and p["volume"] == 0.0 and p["profit"] == 0.0 and len(p["comment"]) == 64 and "evil" not in p
    many = [{**POS, "ticket": i + 1} for i in range(mt5.MAX_ROWS + 50)]
    r.update_trade(w, {"type": "trade", "positions": many, "orders": []})
    assert len(r.trade("Exness-MT5Trial17:12345678")["positions"]) == mt5.MAX_ROWS


def test_deals_sorted_newest_first_and_independent_of_trade_message():
    r, w = registered()
    old = {**DEAL, "ticket": 1, "time": 100}
    bal = {"ticket": 2, "type": "balance", "entry": "", "profit": 10000.0, "time": 300, "symbol": ""}
    r.update_trade(w, {"type": "deals", "deals": [old, DEAL, bal, {**DEAL, "ticket": 9, "type": "weird", "entry": "weird"}]})
    d = r.trade("Exness-MT5Trial17:12345678")["deals"]
    assert [x["ticket"] for x in d] == [333, 9, 2, 1]  # mới nhất trước; cùng giờ giữ thứ tự EA gửi
    assert d[0]["position"] == 0 and d[0]["reason"] == "" and d[0]["sl"] == 0.0  # EA cũ không gửi: mặc định rỗng
    r.update_trade(w, {"type": "deals", "deals": [{**DEAL, "position": 111, "sl": 4090, "tp": 4120, "reason": "tp"}]})
    got = r.trade("Exness-MT5Trial17:12345678")["deals"][0]
    assert (got["position"], got["sl"], got["tp"], got["reason"]) == (111, 4090.0, 4120.0, "tp")
    r.update_trade(w, {"type": "deals", "deals": [old, DEAL, bal, {**DEAL, "ticket": 9, "type": "weird", "entry": "weird"}]})
    assert next(x for x in d if x["ticket"] == 9)["type"] == "other" and next(x for x in d if x["ticket"] == 9)["entry"] == ""
    r.update_trade(w, {"type": "trade", "positions": [POS], "orders": []})
    assert len(r.trade("Exness-MT5Trial17:12345678")["deals"]) == 4  # trade không xoá deals


def test_trade_unknown_account_and_unregistered_writer():
    r, w = registered()
    assert r.trade("nope") is None
    r.update_trade(W(), {"type": "trade", "positions": [POS], "orders": []})  # chưa đăng ký: bỏ
    assert r.trade("Exness-MT5Trial17:12345678")["positions"] == []


def test_account_message_margin_and_permissions():
    r, w = registered()
    r.update(w, {"balance": 1, "margin": 20.5, "margin_level": 4800.0, "margin_mode": "hedging", "trade_allowed": True, "terminal_trade_allowed": False})
    a = r.snapshot()[0]
    assert a["margin"] == 20.5 and a["margin_level"] == 4800.0 and a["margin_mode"] == "hedging"
    assert a["trade_allowed"] is True and a["terminal_trade_allowed"] is False
    r.update(w, {"margin_mode": "<x>", "trade_allowed": "yes"})  # giá trị lạ: giữ nguyên bản cũ
    a = r.snapshot()[0]
    assert a["margin_mode"] == "hedging" and a["trade_allowed"] is True


def test_trade_state_endpoint_needs_login_404_and_is_read_only():
    c = TestClient(app, headers=ORIGIN)
    aid = mt5.registry.register(W(), HELLO)
    assert c.get(f"/accounts/{aid}/trade").status_code == 401  # có vị thế + số dư: khách không xem được
    assert c.post("/auth/register", json={"email": "t@example.com", "password": "correct horse"}).status_code == 201
    assert c.get("/accounts/khong-co/trade").status_code == 404
    body = c.get(f"/accounts/{aid}/trade").json()
    assert body["account"]["id"] == aid and body["positions"] == [] and body["orders"] == [] and body["deals"] == []
    for method in ("post", "put", "patch", "delete"):  # /trade chỉ đọc; gửi lệnh có đường riêng (tests/test_trade.py)
        assert getattr(c, method)(f"/accounts/{aid}/trade").status_code in (404, 405)


def test_tcp_ea_sends_trade_state_end_to_end():
    async def run():
        server = await tcp_server.start_server(host="127.0.0.1", port=0)
        port = server.sockets[0].getsockname()[1]
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        send = lambda m: writer.write((json.dumps(m) + "\n").encode())
        send({"type": "hello", "token": EA_TOKEN, **HELLO})
        send({"type": "account", "balance": 100, "margin": 5, "margin_level": 2000, "margin_mode": "netting", "trade_allowed": True})
        send({"type": "trade", "positions": [POS], "orders": [ORD]})
        send({"type": "deals", "deals": [DEAL]})
        await writer.drain()
        for _ in range(100):
            t = mt5.registry.trade("Exness-MT5Trial17:12345678")
            if t and t["positions"] and t["deals"]:
                break
            await asyncio.sleep(0.02)
        t = mt5.registry.trade("Exness-MT5Trial17:12345678")
        assert [p["ticket"] for p in t["positions"]] == [111] and [o["ticket"] for o in t["orders"]] == [222] and [d["ticket"] for d in t["deals"]] == [333]
        assert t["account"]["margin_mode"] == "netting" and t["account"]["online"] is True
        writer.close()
        server.close()
        await server.wait_closed()

    asyncio.run(run())
