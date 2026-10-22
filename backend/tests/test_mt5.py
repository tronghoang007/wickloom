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
