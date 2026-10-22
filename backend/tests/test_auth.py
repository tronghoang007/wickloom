import pytest
from fastapi.testclient import TestClient

import glob
import os

from app import accounts, auth, config, state
from app.main import app

ORIGIN = {"Origin": "http://localhost:3000"}
PW = "correct horse"
real_iter = accounts.PBKDF2_ITER


@pytest.fixture(autouse=True)
def clean():
    with auth.store.meta.tx() as db:
        db.execute("DELETE FROM sessions")
        db.execute("DELETE FROM users")
        for t in (*accounts.USER_TABLES, ):
            db.execute(f"DELETE FROM {t}")
        db.execute("DELETE FROM settings WHERE id=?", (accounts.LEGACY_FLAG,))
    auth.throttle.fails.clear()
    accounts.PBKDF2_ITER = 1_000  # test chạy nhanh; định dạng hash tự mang số vòng nên verify vẫn đúng
    auth.store.clock = __import__("time").time
    auth.throttle.clock = __import__("time").time
    yield
    accounts.PBKDF2_ITER = real_iter
    auth.store.clock = __import__("time").time
    auth.throttle.clock = __import__("time").time


def client() -> TestClient:
    return TestClient(app, headers=ORIGIN)


def register(c, email="Me@Example.com", password=PW, **extra):
    return c.post("/auth/register", json={"email": email, "password": password, **extra})


def test_register_logs_in_with_safe_cookie():
    c = client()
    r = register(c)
    assert r.status_code == 201
    assert r.json()["user"]["email"] == "me@example.com"  # chuẩn hoá chữ thường
    assert r.json()["user"]["name"] == "me"  # mặc định phần trước @
    assert "pw_hash" not in r.text and "password" not in r.text
    cookie = r.headers["set-cookie"]
    for flag in ("wickloom_session=", "HttpOnly", "SameSite=lax", "Path=/", f"Max-Age={accounts.SESSION_TTL}"):
        assert flag in cookie
    assert "Secure" not in cookie
    assert c.get("/auth/me").json()["user"]["email"] == "me@example.com"


def test_secure_flag_follows_config(monkeypatch):
    monkeypatch.setattr(config, "COOKIE_SECURE", True)
    assert "Secure" in register(client()).headers["set-cookie"]


def test_token_stored_hashed_only():
    c = client()
    register(c)
    token = c.cookies.get("wickloom_session")
    with auth.store.meta.tx() as db:
        hashes = [r[0] for r in db.execute("SELECT token_hash FROM sessions")]
    assert hashes and token not in hashes


def test_register_validation_and_duplicates():
    c = client()
    assert register(c, email="not-an-email").status_code == 422
    assert register(c, password="short").status_code == 422
    assert register(c, password="x" * (accounts.PW_MAX + 1)).status_code == 422
    assert register(c).status_code == 201
    assert register(client(), email="ME@example.COM").status_code == 409  # email không phân biệt hoa-thường


def test_register_can_be_disabled(monkeypatch):
    monkeypatch.setattr(config, "ALLOW_REGISTER", False)
    assert register(client()).status_code == 403


def test_login_logout_me():
    register(client())
    c = client()
    assert c.get("/auth/me").status_code == 401
    r = c.post("/auth/login", json={"email": " ME@example.com ", "password": PW})
    assert r.status_code == 200 and r.json()["user"]["name"] == "me"
    assert c.get("/auth/me").status_code == 200
    assert c.post("/auth/logout").status_code == 200
    assert c.get("/auth/me").status_code == 401


def test_wrong_password_and_unknown_email_look_the_same():
    register(client())
    a = client().post("/auth/login", json={"email": "me@example.com", "password": "wrong password"})
    b = client().post("/auth/login", json={"email": "nobody@example.com", "password": PW})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json() == {"detail": auth.BAD_LOGIN}
    assert client().post("/auth/login", json={"email": "me@example.com", "password": "x" * 5000}).status_code == 401


def test_foreign_origin_blocked_on_unsafe_methods():
    c = TestClient(app)
    body = {"email": "me@example.com", "password": PW}
    assert c.post("/auth/register", json=body, headers={"Origin": "http://evil.example"}).status_code == 403
    assert c.post("/auth/register", json=body, headers={"Origin": "null"}).status_code == 403
    assert c.post("/auth/register", json=body, headers={"Origin": "http://127.0.0.1:3000"}).status_code == 201
    # GET không đổi dữ liệu nên không bị chặn; request không Origin (curl) cũng qua
    assert c.get("/health", headers={"Origin": "http://evil.example"}).status_code == 200
    assert c.post("/auth/login", json=body).status_code == 200


def test_cors_allows_credentials_for_known_origin_only():
    c = TestClient(app)
    ok = c.options("/auth/me", headers={**ORIGIN, "Access-Control-Request-Method": "GET"})
    assert ok.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert ok.headers["access-control-allow-credentials"] == "true"
    bad = c.options("/auth/me", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers


def test_session_expires_and_slides():
    now = [1_000_000.0]
    auth.store.clock = lambda: now[0]
    c = client()
    register(c)
    now[0] += 20 * 86400  # còn 10 ngày < 15 -> gia hạn lại đủ 30 ngày
    r = c.get("/auth/me")
    assert r.status_code == 200 and "Max-Age" in r.headers["set-cookie"]
    now[0] += 20 * 86400  # 20 ngày sau lần gia hạn: còn 10 ngày, vẫn sống nhờ gia hạn trước đó
    assert c.get("/auth/me").status_code == 200
    now[0] += 31 * 86400  # không dùng quá 30 ngày -> hết hạn
    assert c.get("/auth/me").status_code == 401
    with auth.store.meta.tx() as db:
        assert db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0  # phiên hết hạn bị xoá


def test_fresh_session_is_not_renewed_every_request():
    c = client()
    register(c)
    assert "set-cookie" not in c.get("/auth/me").headers


def test_lock_after_five_wrong_passwords():
    now = [5_000.0]
    auth.throttle.clock = lambda: now[0]
    register(client())
    c = client()
    bad = {"email": "me@example.com", "password": "wrong password"}
    for _ in range(5):
        assert c.post("/auth/login", json=bad).status_code == 401
    r = c.post("/auth/login", json={"email": "me@example.com", "password": PW})  # đúng mật khẩu vẫn bị khoá
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0
    assert c.post("/auth/login", json={"email": "other@example.com", "password": "x"}).status_code == 401  # khoá theo email
    now[0] += 61
    assert c.post("/auth/login", json={"email": "me@example.com", "password": PW}).status_code == 200
    assert ("testclient", "me@example.com") not in auth.throttle.fails  # đăng nhập đúng xoá bộ đếm


def test_lock_grows_on_repeated_failures():
    now = [5_000.0]
    auth.throttle.clock = lambda: now[0]
    key = ("1.2.3.4", "a@b.co")
    for _ in range(5):
        auth.throttle.fail(key)
    assert 55 <= auth.throttle.wait(key) <= 61
    now[0] += 61
    auth.throttle.fail(key)
    assert 115 <= auth.throttle.wait(key) <= 121  # lần sai thứ 6 -> 120s


def test_change_password_revokes_other_sessions():
    a, b = client(), client()
    register(a)
    b.post("/auth/login", json={"email": "me@example.com", "password": PW})
    assert b.get("/auth/me").status_code == 200
    assert a.post("/auth/password", json={"old": "nope nope nope", "new": "brand new pw"}).status_code == 401
    assert a.post("/auth/password", json={"old": PW, "new": "short"}).status_code == 422
    assert a.post("/auth/password", json={"old": PW, "new": "brand new pw"}).status_code == 200
    assert a.get("/auth/me").status_code == 200  # phiên đang đổi vẫn sống
    assert b.get("/auth/me").status_code == 401  # phiên khác bị thu hồi
    assert client().post("/auth/login", json={"email": "me@example.com", "password": PW}).status_code == 401
    assert client().post("/auth/login", json={"email": "me@example.com", "password": "brand new pw"}).status_code == 200


def test_change_password_requires_login():
    assert client().post("/auth/password", json={"old": PW, "new": "brand new pw"}).status_code == 401


def test_update_display_name():
    c = client()
    register(c)
    assert c.patch("/auth/me", json={"name": "  Trong Hoang  "}).json()["user"]["name"] == "Trong Hoang"
    assert c.get("/auth/me").json()["user"]["name"] == "Trong Hoang"
    assert c.patch("/auth/me", json={"name": " "}).json()["user"]["name"] == "me"  # rỗng -> mặc định
    assert client().patch("/auth/me", json={"name": "x"}).status_code == 401


def test_password_hash_format_and_tamper():
    assert real_iter >= 600_000
    h = accounts.hash_password(PW)
    assert h.startswith("pbkdf2_sha256$1000$") and accounts.verify_password(PW, h)
    assert not accounts.verify_password("other password", h)
    assert not accounts.verify_password(PW, "garbage") and not accounts.verify_password(PW, "scrypt$16384$8$1$ab$cd")


def test_auth_cli_reset_revokes_sessions(monkeypatch):
    from app import auth_cli

    c = client()
    register(c)
    answers = iter(["fresh password", "fresh password"])
    monkeypatch.setattr("getpass.getpass", lambda _="": next(answers))
    monkeypatch.setattr(auth_cli, "MetaStore", lambda: auth.store.meta)
    assert auth_cli.main(["reset", "me@example.com"]) == 0
    assert c.get("/auth/me").status_code == 401
    assert client().post("/auth/login", json={"email": "me@example.com", "password": "fresh password"}).status_code == 200
    assert auth_cli.main(["reset", "ghost@example.com"]) == 1


# --- /me/*: dữ liệu theo user --------------------------------------------------------------------
def two_users():
    a, b = client(), client()
    register(a, email="a@example.com")
    register(b, email="b@example.com")
    return a, b


def test_me_requires_login():
    c = client()
    for path in ("/me/watchlist", "/me/layouts", "/me/layouts/x", "/me/drawings", "/me/drawings/x"):
        assert c.get(path).status_code == 401, path
    assert c.put("/me/watchlist", json={"symbols": []}).status_code == 401
    assert c.put("/me/layouts/x", json={}).status_code == 401
    assert c.delete("/me/drawings/x").status_code == 401


def test_me_watchlist_roundtrip_hides_user_prefix():
    c = client()
    register(c)
    assert c.get("/me/watchlist").status_code == 404
    assert c.put("/me/watchlist", json={"symbols": ["XAUUSDm", "BTCUSDm"]}).status_code == 200
    r = c.get("/me/watchlist").json()
    assert r == {"id": "default", "data": {"symbols": ["XAUUSDm", "BTCUSDm"]}}


@pytest.mark.parametrize("table", ["layouts", "drawings"])
def test_me_collection_crud_and_isolation(table):
    a, b = two_users()
    doc = {"version": 1, "items": [1, 2, 3]}
    assert a.put(f"/me/{table}/XAUUSD__default", params={"scope": "XAUUSD"}, json=doc).status_code == 200
    assert a.get(f"/me/{table}/XAUUSD__default").json() == {"id": "XAUUSD__default", "data": doc}
    assert [r["id"] for r in a.get(f"/me/{table}").json()] == ["XAUUSD__default"]
    # user B cùng id không thấy / không đè / không xoá được của A
    assert b.get(f"/me/{table}/XAUUSD__default").status_code == 404
    assert b.get(f"/me/{table}").json() == []
    b.put(f"/me/{table}/XAUUSD__default", json={"version": 1, "items": ["b"]})
    b.delete(f"/me/{table}/XAUUSD__default")
    assert a.get(f"/me/{table}/XAUUSD__default").json()["data"] == doc
    assert a.delete(f"/me/{table}/XAUUSD__default").status_code == 200
    assert a.get(f"/me/{table}/XAUUSD__default").status_code == 404


def test_me_rows_carry_owner_in_db():
    c = client()
    uid = register(c).json()["user"]["id"]
    c.put("/me/layouts/default", json={"name": "x"})
    row = state.meta.get("layouts", f"{uid}:default")
    assert row and row["scope"] == uid
    assert state.meta.get("layouts", "default") is None


def test_generic_crud_closed_for_user_tables():
    c = client()
    register(c)
    for t in accounts.USER_TABLES:
        assert c.get(f"/{t}").status_code == 404
        assert c.get(f"/{t}/x").status_code == 404
        assert c.put(f"/{t}/x", json={"a": 1}).status_code in (404, 405)
        assert c.delete(f"/{t}/x").status_code in (404, 405)
    assert c.get("/settings/anything").status_code == 404  # bảng không phải của user vẫn còn generic


# --- chuyển dữ liệu cũ ---------------------------------------------------------------------------
def seed_legacy():
    state.meta.put("watchlists", "default", "default", {"symbols": ["OLD"]})
    state.meta.put("drawings", "XAUUSDm__default", "XAUUSDm", {"version": 1, "items": [{"id": "d1"}]})
    state.meta.put("drawings", "EURUSD__default", "EURUSD", {"version": 1, "items": []})


def backups():
    return glob.glob(os.path.join(os.path.dirname(state.meta.path), "meta_pre_auth_*.sqlite"))


def test_options_reports_legacy_only_before_first_user():
    c = client()
    assert c.get("/auth/options").json() == {"allow_register": True, "claim_legacy": False}  # không có gì để nhận
    seed_legacy()
    assert c.get("/auth/options").json()["claim_legacy"] is True
    register(c)
    assert c.get("/auth/options").json()["claim_legacy"] is False  # đã có user


def test_first_user_claims_legacy_data_with_backup():
    seed_legacy()
    other = "f" * 32  # hàng của một user khác phải đứng yên
    state.meta.put("drawings", f"{other}:XAUUSDm__default", other, {"version": 1, "items": ["theirs"]})
    for f in backups():
        os.remove(f)
    c = client()
    r = register(c, claim_legacy=True)
    assert r.json()["claimed"] == 3
    assert c.get("/me/watchlist").json()["data"] == {"symbols": ["OLD"]}
    assert c.get("/me/drawings/XAUUSDm__default").json()["data"]["items"] == [{"id": "d1"}]
    assert sorted(x["id"] for x in c.get("/me/drawings").json()) == ["EURUSD__default", "XAUUSDm__default"]
    assert state.meta.get("drawings", "XAUUSDm__default") is None  # không còn hàng không chủ
    assert state.meta.get("drawings", f"{other}:XAUUSDm__default")["data"]["items"] == ["theirs"]
    assert len(backups()) == 1
    # file sao lưu còn nguyên dữ liệu cũ
    import sqlite3
    old = sqlite3.connect(backups()[0]).execute("SELECT id FROM drawings WHERE id=?", ("XAUUSDm__default",)).fetchone()
    assert old is not None
    # user thứ hai không nhận được gì, kể cả khi tick
    d = client()
    assert register(d, email="two@example.com", claim_legacy=True).json()["claimed"] == 0
    assert d.get("/me/watchlist").status_code == 404 and d.get("/me/drawings").json() == []


def test_first_user_without_tick_leaves_legacy_untouched():
    seed_legacy()
    c = client()
    assert register(c).json()["claimed"] == 0
    assert state.meta.get("drawings", "XAUUSDm__default") is not None
    assert c.get("/me/drawings/XAUUSDm__default").status_code == 404  # route generic đã đóng, /me không thấy
    assert c.get("/drawings/XAUUSDm__default").status_code == 404


def test_cli_claim_legacy_later(monkeypatch):
    from app import auth_cli

    seed_legacy()
    c = client()
    register(c)
    monkeypatch.setattr(auth_cli, "MetaStore", lambda: auth.store.meta)
    assert auth_cli.main(["claim-legacy", "me@example.com"]) == 0
    assert c.get("/me/drawings/EURUSD__default").status_code == 200
    assert auth_cli.main(["claim-legacy", "me@example.com"]) == 1  # chạy lần 2: không làm gì
    assert auth_cli.main(["claim-legacy", "ghost@example.com"]) == 1
