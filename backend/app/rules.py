"""Quy tắc thông báo theo user ngoài alert giá (docs/alerts-plan.md Phase 3): báo trước tin kinh tế, vị thế chạm SL/TP và lệnh chờ khớp. Mỗi user một dòng mỗi loại trong
bảng `notify_rules` (meta.sqlite, KHÔNG nằm trong `TABLES` của store.py vì CRUD generic của bảng đó mở cho ai cũng ghi). Watcher (newswatch.py, tradewatch.py) hỏi `enabled(kind)`
để biết gửi cho ai và qua kênh nào; việc giao tin dùng chung Dispatcher của alert (alerts.py). Mặc định TẮT: người dùng tự bật trong Settings → Alerts."""
import json
from typing import Any, Dict, List, Tuple

from fastapi import APIRouter, Depends, HTTPException

from . import alerts, state
from .auth import current_user

KINDS = ("news", "trade")
MAX_LEADS = 3
MAX_LEAD_MIN = 1440
MAX_CURRENCIES = 20

DEFAULTS: Dict[str, Dict[str, Any]] = {
    # leads: báo trước bao nhiêu phút (nhiều mốc được); min_importance 1 thấp / 2 vừa / 3 cao; currencies rỗng = mọi đồng tiền
    "news": {"enabled": False, "leads": [15], "min_importance": 3, "currencies": [], "channels": {"web": True, "telegram": False, "mt5": False}},
    # sl / tp / fill: loại sự kiện muốn báo (vị thế bị stop out luôn báo khi đã bật)
    "trade": {"enabled": False, "sl": True, "tp": True, "fill": True, "channels": {"web": True, "telegram": False, "mt5": False}},
}

with state.meta.tx() as _db:
    _db.execute("CREATE TABLE IF NOT EXISTS notify_rules (user_id TEXT NOT NULL, kind TEXT NOT NULL, config TEXT NOT NULL, PRIMARY KEY (user_id, kind))")


def _bad(msg: str) -> HTTPException:
    return HTTPException(422, msg)


def _merge(kind: str, stored: Dict[str, Any]) -> Dict[str, Any]:
    """Cấu hình đã lưu đè lên mặc định (bỏ khoá lạ): bản lưu cũ thiếu trường mới vẫn đọc được."""
    d = json.loads(json.dumps(DEFAULTS[kind]))
    d.update({k: v for k, v in stored.items() if k in d})
    return d


def get(user_id: str, kind: str) -> Dict[str, Any]:
    with state.meta._lock:
        row = state.meta.db.execute("SELECT config FROM notify_rules WHERE user_id=? AND kind=?", (user_id, kind)).fetchone()
    return _merge(kind, json.loads(row[0]) if row else {})


def put(user_id: str, kind: str, cfg: Dict[str, Any]) -> None:
    with state.meta.tx() as db:
        db.execute("INSERT INTO notify_rules (user_id, kind, config) VALUES (?,?,?) ON CONFLICT(user_id, kind) DO UPDATE SET config=excluded.config", (user_id, kind, json.dumps(cfg)))


def enabled(kind: str) -> List[Tuple[str, Dict[str, Any]]]:
    """(user_id, cấu hình) của mọi user đã bật loại này."""
    with state.meta._lock:
        rows = state.meta.db.execute("SELECT user_id, config FROM notify_rules WHERE kind=?", (kind,)).fetchall()
    out = [(uid, _merge(kind, json.loads(c))) for uid, c in rows]
    return [(uid, cfg) for uid, cfg in out if cfg["enabled"]]


def clean(kind: str, user: Dict[str, Any], base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    """`patch` đè lên `base`; kiểu sai / giá trị ngoài khoảng -> 422 (không lưu nửa vời)."""
    cfg = {**base}
    for k, v in patch.items():
        if k not in DEFAULTS[kind]:
            raise _bad(f"Không có tuỳ chọn '{k}'")
        cfg[k] = v
    for k in ("enabled", "sl", "tp", "fill"):
        if k in cfg and not isinstance(cfg[k], bool):
            raise _bad(f"'{k}' phải là true / false")
    if kind == "news":
        leads = cfg["leads"]
        if not isinstance(leads, list) or not all(isinstance(m, int) and not isinstance(m, bool) and 1 <= m <= MAX_LEAD_MIN for m in leads):
            raise _bad(f"Số phút báo trước phải từ 1 tới {MAX_LEAD_MIN}")
        cfg["leads"] = sorted(set(leads), reverse=True)
        if not cfg["leads"] or len(cfg["leads"]) > MAX_LEADS:
            raise _bad(f"Chọn từ 1 tới {MAX_LEADS} mốc báo trước")
        if isinstance(cfg["min_importance"], bool) or cfg["min_importance"] not in (1, 2, 3):
            raise _bad("Mức quan trọng phải là 1, 2 hoặc 3")
        cur = cfg["currencies"]
        if not isinstance(cur, list) or len(cur) > MAX_CURRENCIES or not all(isinstance(c, str) and c.strip().isalpha() and 2 <= len(c.strip()) <= 4 for c in cur):
            raise _bad("Danh sách đồng tiền không hợp lệ")
        cfg["currencies"] = sorted({c.strip().upper() for c in cur})
    ch = cfg["channels"]
    if not isinstance(ch, dict):
        raise _bad("Kênh không hợp lệ")
    # Đang tắt thì không bắt phải có kênh (người dùng chỉ muốn cất cấu hình); bật thì kiểm như alert (ít nhất một kênh, Telegram phải đã kết nối)
    cfg["channels"] = alerts.check_channels(user, ch) if cfg["enabled"] else {k: bool(ch.get(k)) for k in alerts.CHANNEL_KEYS}
    return cfg


router = APIRouter(prefix="/alerts/rules")


@router.get("")
def get_rules(user: Dict[str, Any] = Depends(current_user)):
    return {kind: get(user["id"], kind) for kind in KINDS}


@router.patch("/{kind}")
def patch_rule(kind: str, body: Dict[str, Any], user: Dict[str, Any] = Depends(current_user)):
    if kind not in KINDS:
        raise HTTPException(404)
    cfg = clean(kind, user, get(user["id"], kind), body)
    put(user["id"], kind, cfg)
    return cfg
