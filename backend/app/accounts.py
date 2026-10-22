"""Tài khoản Wickloom: bảng users/sessions trong meta.sqlite + băm mật khẩu. Không phụ thuộc FastAPI
để `auth_cli` dùng chung."""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from typing import Any, Callable, Dict, Optional, Tuple

from .store import MetaStore

# PBKDF2 thay scrypt: Python build với LibreSSL (macOS system python) không có hashlib.scrypt. 600k = khuyến nghị OWASP 2023.
PBKDF2_ITER = 600_000
PW_MIN, PW_MAX = 8, 128  # chặn mật khẩu quá ngắn / chuỗi dài
SESSION_TTL = 30 * 86400
SESSION_SLIDE_BELOW = 15 * 86400  # còn dưới ngần này thì gia hạn lại đủ TTL
LAST_SEEN_EVERY = 60  # không ghi last_seen mỗi request

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Bảng dữ liệu người dùng: id lưu dạng "<user_id>:<id client>", scope = user_id (khoá chính chỉ là `id`
# nên hai user cùng "XAUUSD__default" không đè nhau). Hàng chưa có tiền tố là dữ liệu từ trước khi có tài khoản.
USER_TABLES = ("watchlists", "drawings", "layouts")
_OWNED_RE = re.compile(r"^[0-9a-f]{32}:")
LEGACY_FLAG = "auth_legacy_claimed"


class DuplicateEmail(Exception):
    pass


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def valid_email(email: str) -> bool:
    return len(email) <= 254 and bool(_EMAIL_RE.match(email))


def _pbkdf2(pw: str, salt: bytes, iters: int, dklen: int = 32) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, iters, dklen)


def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    return f"pbkdf2_sha256${PBKDF2_ITER}${salt.hex()}${_pbkdf2(pw, salt, PBKDF2_ITER).hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        scheme, iters, salt, h = stored.split("$")
        if scheme != "pbkdf2_sha256" or not 0 < int(iters) <= 10_000_000:
            return False
        want = bytes.fromhex(h)
        dk = _pbkdf2(pw, bytes.fromhex(salt), int(iters), len(want))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk, want)


_dummy: Dict[str, str] = {}


def dummy_hash() -> str:
    """Hash giả để đăng nhập email không tồn tại vẫn tốn một lần băm (thời gian không lộ email có hay không)."""
    if "h" not in _dummy:
        _dummy["h"] = hash_password("wickloom-dummy-password")
    return _dummy["h"]


def _sha(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _public(row: Tuple[Any, ...]) -> Dict[str, Any]:
    return {"id": row[0], "email": row[1], "name": row[2]}


class AuthStore:
    def __init__(self, meta: MetaStore, clock: Callable[[], float] = time.time):
        self.meta = meta
        self.clock = clock
        with meta.tx() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, "
                "name TEXT NOT NULL DEFAULT '', pw_hash TEXT NOT NULL, created_at INTEGER NOT NULL, "
                "last_login_at INTEGER)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, "
                "created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, "
                "ua TEXT NOT NULL DEFAULT '')"
            )
            db.execute("CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)")

    # --- users -------------------------------------------------------------------------------
    def count_users(self) -> int:
        with self.meta.tx() as db:
            return db.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    def create_user(self, email: str, name: str, password: str) -> Dict[str, Any]:
        email = normalize_email(email)
        uid = uuid.uuid4().hex
        pw = hash_password(password)  # tính trước khi giữ lock DB
        try:
            with self.meta.tx() as db:
                db.execute(
                    "INSERT INTO users (id, email, name, pw_hash, created_at) VALUES (?,?,?,?,?)",
                    (uid, email, name, pw, int(self.clock())),
                )
        except sqlite3.IntegrityError:
            raise DuplicateEmail(email)
        return {"id": uid, "email": email, "name": name}

    def by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Kèm `pw_hash` - chỉ dùng nội bộ, đừng trả ra ngoài."""
        with self.meta.tx() as db:
            row = db.execute(
                "SELECT id, email, name, pw_hash FROM users WHERE email=?", (normalize_email(email),)
            ).fetchone()
        return {**_public(row), "pw_hash": row[3]} if row else None

    def by_id(self, uid: str) -> Optional[Dict[str, Any]]:
        with self.meta.tx() as db:
            row = db.execute("SELECT id, email, name, pw_hash FROM users WHERE id=?", (uid,)).fetchone()
        return {**_public(row), "pw_hash": row[3]} if row else None

    def set_name(self, uid: str, name: str) -> None:
        with self.meta.tx() as db:
            db.execute("UPDATE users SET name=? WHERE id=?", (name, uid))

    def set_password(self, uid: str, password: str) -> None:
        pw = hash_password(password)
        with self.meta.tx() as db:
            db.execute("UPDATE users SET pw_hash=? WHERE id=?", (pw, uid))

    # --- sessions ----------------------------------------------------------------------------
    def create_session(self, uid: str, ua: str = "") -> str:
        token = secrets.token_urlsafe(32)
        now = int(self.clock())
        with self.meta.tx() as db:
            db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            db.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen, ua) VALUES (?,?,?,?,?,?)",
                (_sha(token), uid, now, now + SESSION_TTL, now, ua[:200]),
            )
            db.execute("UPDATE users SET last_login_at=? WHERE id=?", (now, uid))
        return token

    def resolve_session(self, token: str) -> Optional[Tuple[Dict[str, Any], bool]]:
        """(user, đã_gia_hạn) nếu token còn hạn, ngược lại None. Gia hạn trượt khi còn < SESSION_SLIDE_BELOW."""
        th, now = _sha(token), int(self.clock())
        with self.meta.tx() as db:
            row = db.execute(
                "SELECT u.id, u.email, u.name, s.expires_at, s.last_seen FROM sessions s "
                "JOIN users u ON u.id = s.user_id WHERE s.token_hash=?", (th,)
            ).fetchone()
            if row is None:
                return None
            if row[3] <= now:
                db.execute("DELETE FROM sessions WHERE token_hash=?", (th,))
                return None
            renewed = row[3] - now < SESSION_SLIDE_BELOW
            if renewed:
                db.execute("UPDATE sessions SET expires_at=?, last_seen=? WHERE token_hash=?",
                           (now + SESSION_TTL, now, th))
            elif now - row[4] >= LAST_SEEN_EVERY:
                db.execute("UPDATE sessions SET last_seen=? WHERE token_hash=?", (now, th))
        return _public(row), renewed

    def revoke(self, token: str) -> None:
        with self.meta.tx() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (_sha(token),))

    def revoke_user(self, uid: str, keep_token: Optional[str] = None) -> None:
        """Thu hồi mọi session của user (trừ `keep_token` nếu có) - sau đổi/reset mật khẩu."""
        with self.meta.tx() as db:
            if keep_token:
                db.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", (uid, _sha(keep_token)))
            else:
                db.execute("DELETE FROM sessions WHERE user_id=?", (uid,))

    # --- dữ liệu cũ (trước khi có tài khoản) -----------------------------------------------------
    def _legacy_ids(self, db: sqlite3.Connection) -> Dict[str, list]:
        return {t: [i for (i,) in db.execute(f"SELECT id FROM {t}") if not _OWNED_RE.match(i)] for t in USER_TABLES}

    def legacy_count(self) -> int:
        with self.meta.tx() as db:
            return sum(len(v) for v in self._legacy_ids(db).values())

    def legacy_claimed(self) -> bool:
        with self.meta.tx() as db:
            return db.execute("SELECT 1 FROM settings WHERE id=?", (LEGACY_FLAG,)).fetchone() is not None

    def legacy_available(self) -> bool:
        return not self.legacy_claimed() and self.legacy_count() > 0

    def claim_legacy(self, uid: str) -> int:
        """Giao watchlist/drawings/layouts chưa có chủ cho `uid`. Sao lưu DB trước, đổi trong 1 transaction, chỉ làm
        một lần (cờ `auth_legacy_claimed`). Trả số hàng đã chuyển (0 nếu đã nhận hoặc không có gì)."""
        if not self.legacy_available():
            return 0
        stem = f"meta_pre_auth_{int(self.clock())}"
        dest = self.meta.path.parent / f"{stem}.sqlite"
        for n in range(2, 100):  # VACUUM INTO không ghi đè file có sẵn
            if not dest.exists():
                break
            dest = self.meta.path.parent / f"{stem}_{n}.sqlite"
        self.meta.backup(dest)
        moved = 0
        with self.meta.tx() as db:
            if db.execute("SELECT 1 FROM settings WHERE id=?", (LEGACY_FLAG,)).fetchone():
                return 0  # có request khác nhận trước trong lúc sao lưu
            for table, ids in self._legacy_ids(db).items():
                for i in ids:
                    db.execute(f"UPDATE {table} SET id=?, scope=? WHERE id=?", (f"{uid}:{i}", uid, i))
                    moved += 1
            db.execute(
                "INSERT INTO settings (id, scope, data) VALUES (?,?,?)",
                (LEGACY_FLAG, "", json.dumps({"user_id": uid, "rows": moved, "at": int(self.clock())})),
            )
        return moved
