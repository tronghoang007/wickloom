import asyncio
import json
import time

import pytest
from fastapi.testclient import TestClient

from app import economic, mt5, state, tcp_server
from app.config import EA_TOKEN
from app.main import app

ORIGIN = {"Origin": "http://localhost:3000"}
NOW = 1_800_000_000
HELLO = {"server": "Exness-MT5Trial17", "broker": "Exness Technologies Ltd", "login": 12345678, "name": "T", "mode": "demo", "currency": "USD", "leverage": 500}


def ev(i, t, **kw):
    return {"id": i, "time": t, "event_id": 100 + i, "country": "US", "currency": "USD", "name": f"Event {i}", "importance": 2, "unit": 2, "multiplier": 0, "digits": 1,
            "time_mode": 0, "impact": 0, "actual": None, "forecast": 3.5, "previous": 3.4, "revised": None, **kw}


@pytest.fixture(autouse=True)
def clean():
    with state.meta.tx() as db:
        db.execute("DELETE FROM calendar_events")
    state.meta.delete("settings", economic.META_KEY)
    mt5.registry.clear()
    state.meta.put("settings", "broker", "", {"name": HELLO["broker"], "server": HELLO["server"]})
    yield
    with state.meta.tx() as db:
        db.execute("DELETE FROM calendar_events")
    mt5.registry.clear()


def rows(lo=0, hi=10**12, **kw):
    return economic.query(lo, hi, **kw)


def test_clean_event_coerces_types_and_drops_junk():
    e = economic.clean_event({"id": 7, "time": 1_700_000_000.9, "name": "  CPI m/m  ", "currency": "usd", "importance": 9, "actual": "x", "forecast": float("nan"), "previous": 1.5, "digits": -3})
    assert e["time"] == 1_700_000_000 and e["name"] == "CPI m/m" and e["currency"] == "USD"
    assert e["importance"] == 3  # kẹp vào 0..3
    assert e["actual"] is None and e["forecast"] is None and e["previous"] == 1.5
    assert e["digits"] == 0
    assert economic.clean_event({"time": 5}) is None and economic.clean_event({"id": 5}) is None and economic.clean_event("x") is None


def test_ingest_stores_and_upserts_by_id():
    assert economic.ingest({"from": NOW, "to": NOW + 100, "events": [ev(1, NOW + 10), ev(2, NOW + 20, importance=3)]}, now=NOW) == 2
    assert [r["id"] for r in rows()] == [1, 2]
    # EA công bố số thật: cùng id → cập nhật tại chỗ, không nhân đôi
    economic.ingest({"from": NOW, "to": NOW + 100, "events": [ev(1, NOW + 10, actual=3.9, impact=1), ev(2, NOW + 20, importance=3)]}, now=NOW + 5)
    r = rows()
    assert len(r) == 2 and r[0]["actual"] == 3.9 and r[0]["impact"] == 1


def test_event_missing_from_the_new_window_is_removed_but_older_history_stays():
    economic.ingest({"from": NOW, "to": NOW + 1000, "events": [ev(1, NOW + 10), ev(2, NOW + 20), ev(3, NOW + 900)]}, now=NOW)
    # lần sau: sự kiện 2 bị huỷ; cửa sổ mới bắt đầu muộn hơn nên sự kiện 1 (cũ) vẫn giữ
    economic.ingest({"from": NOW + 15, "to": NOW + 1000, "events": [ev(3, NOW + 900)]}, now=NOW + 60)
    assert [r["id"] for r in rows()] == [1, 3]


def test_empty_list_does_not_wipe_anything_and_retention_purges_old():
    economic.ingest({"from": NOW, "to": NOW + 100, "events": [ev(1, NOW + 10)]}, now=NOW)
    assert economic.ingest({"from": NOW, "to": NOW + 100, "events": []}, now=NOW) == 0  # MT5 chưa đồng bộ lịch cũng trả rỗng
    assert len(rows()) == 1
    old = NOW - (economic.RETENTION_DAYS + 1) * 86400
    economic.ingest({"from": old, "to": old + 10, "events": [ev(9, old + 1)]}, now=NOW)
    assert [r["id"] for r in rows()] == [1]  # quá hạn lưu: bị dọn ngay khi nhận


def test_bad_payloads_are_ignored():
    assert economic.ingest({"events": "nope"}) == 0
    assert economic.ingest({"events": [None, 5, {"x": 1}]}) == 0
    assert rows() == []


def test_query_filters_by_range_importance_and_currency():
    economic.ingest(
        {"from": NOW, "to": NOW + 1000, "events": [ev(1, NOW + 10, importance=1), ev(2, NOW + 20, currency="EUR", importance=3), ev(3, NOW + 30, importance=2), ev(4, NOW + 5000)]},
        now=NOW,
    )
    assert [r["id"] for r in rows(NOW, NOW + 100)] == [1, 2, 3]
    assert [r["id"] for r in rows(NOW, NOW + 100, min_importance=2)] == [2, 3]
    assert [r["id"] for r in rows(NOW, NOW + 100, currencies=["EUR"])] == [2]
    assert [r["id"] for r in rows(NOW, NOW + 100, currencies=["USD", "EUR"], min_importance=3)] == [2]


def test_endpoint_is_public_read_only_and_reports_ea_status():
    c = TestClient(app, headers=ORIGIN)
    body = c.get("/calendar", params={"from": NOW, "to": NOW + 100}).json()
    assert body["events"] == [] and body["updated_at"] is None and body["ea"] == {"online": False, "version": None, "supports": False}
    economic.ingest({"from": NOW, "to": NOW + 100, "events": [ev(1, NOW + 10), ev(2, NOW + 20, currency="JPY", importance=3)]}, now=NOW)
    body = c.get("/calendar", params={"from": NOW, "to": NOW + 100, "currencies": "jpy"}).json()
    assert [e["id"] for e in body["events"]] == [2] and body["updated_at"] == NOW
    assert c.get("/calendar", params={"from": NOW, "to": NOW + 100, "min_importance": 9}).status_code == 422
    # chỉ GET: không có đường ghi từ web
    assert c.put("/calendar/1", json={}).status_code in (404, 405)
    assert c.delete("/calendar/1").status_code in (404, 405)


def test_endpoint_caps_range_and_defaults_to_recent_week():
    c = TestClient(app, headers=ORIGIN)
    now = int(time.time())
    economic.ingest({"from": now - 90 * 86400, "to": now + 90 * 86400, "events": [ev(1, now + 3600), ev(2, now + 80 * 86400), ev(3, now - 40 * 86400)]}, now=now)
    assert [e["id"] for e in c.get("/calendar").json()["events"]] == [1]  # mặc định: hôm qua → +7 ngày
    far = c.get("/calendar", params={"from": now - 60 * 86400, "to": now + 400 * 86400}).json()
    assert [e["id"] for e in far["events"]] == [3, 1]  # cắt ở MAX_RANGE_DAYS kể từ `from`


def test_ea_status_needs_version_215_and_online():
    class W:
        pass

    w = W()
    mt5.registry.register(w, HELLO)
    mt5.registry.update(w, {"ea_version": "2.14"})
    assert economic._ea_status() == {"online": True, "version": "2.14", "supports": False}
    mt5.registry.update(w, {"ea_version": "2.15"})
    assert economic._ea_status()["supports"] is True
    mt5.registry.remove(w)
    assert economic._ea_status()["online"] is False


def test_tcp_ea_calendar_message_is_stored():
    async def run():
        server = await tcp_server.start_server(host="127.0.0.1", port=0)
        port = server.sockets[0].getsockname()[1]
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        send = lambda m: writer.write((json.dumps(m) + "\n").encode())
        send({"type": "hello", "token": EA_TOKEN, **HELLO})
        send({"type": "calendar", "from": NOW, "to": NOW + 100, "events": [ev(1, NOW + 10), {"junk": True}]})
        send({"type": "ping"})
        await writer.drain()
        for _ in range(100):
            if rows():
                break
            await asyncio.sleep(0.02)
        assert [r["id"] for r in rows()] == [1]
        writer.close()
        server.close()
        await server.wait_closed()

    asyncio.run(run())
