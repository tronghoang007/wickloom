import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

from .config import BARS_DB, SQLITE_PATH

_COLS = ("t", "o", "h", "l", "c", "v")
TICK_KEEP = 21 * 86400  # giữ tick profile + nến delta tick (tf "TD") tối đa chừng này giây tính từ phút mới nhất; web chỉ dùng 14 ngày


class BarStore:
    """SQLite: 1 bảng bars, khoá (symbol, tf, t) -> upsert/đọc theo index, không phải ghi
    lại cả file như parquet theo năm (ghi 1 bar vào file 50k bar mất ~100ms, chặn cả
    event loop)."""

    def __init__(self, path: Path = BARS_DB):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.Lock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS bars (symbol TEXT NOT NULL, tf TEXT NOT NULL, t INTEGER NOT NULL, "
            "o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL, "
            "PRIMARY KEY (symbol, tf, t)) WITHOUT ROWID"
        )
        # Histogram giá theo phút của tick (Volume Profile "1 tick"), cùng lượt ghi với nến "TD". Bảng mới: nến "TD" cũ không có histogram nên bỏ để nạp lại
        has_vp = self.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tickvp'").fetchone()
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS tickvp (symbol TEXT NOT NULL, t INTEGER NOT NULL, p REAL NOT NULL, up REAL NOT NULL, dn REAL NOT NULL, "
            "PRIMARY KEY (symbol, t, p)) WITHOUT ROWID"
        )
        if not has_vp:
            self.db.execute("DELETE FROM bars WHERE tf='TD'")
        self.db.commit()

    def put_tickvp(self, symbol: str, t0: int, t1: int, rows: List[Tuple[int, float, float, float]]) -> None:
        """Ghi histogram các phút [t0, t1] (UTC giây): xoá phút cũ trong khoảng rồi ghi `rows` (t, giá, volume lên, volume xuống), vì bản mới của một phút
        (EA tính lại phút đang chạy) có thể thiếu giá mà bản cũ có. Dọn dữ liệu cũ hơn `TICK_KEEP` so với phút mới nhất."""
        with self._lock:
            self.db.execute("DELETE FROM tickvp WHERE symbol=? AND t>=? AND t<=?", (symbol, t0, t1))
            self.db.executemany("INSERT INTO tickvp VALUES (?,?,?,?,?)", [(symbol, t, p, u, d) for t, p, u, d in rows])
            row = self.db.execute("SELECT t FROM tickvp WHERE symbol=? ORDER BY t DESC LIMIT 1", (symbol,)).fetchone()
            if row:
                old = row[0] - TICK_KEEP
                self.db.execute("DELETE FROM tickvp WHERE symbol=? AND t<?", (symbol, old))
                self.db.execute("DELETE FROM bars WHERE symbol=? AND tf='TD' AND t<?", (symbol, old))
            self.db.commit()

    def tickvp(self, symbol: str, frm: int, to: int, lo: float, size: float, n: int) -> Tuple[List[float], List[float]]:
        """Volume lên / xuống của các phút [frm, to) gom vào `n` row, row i phủ giá [lo + i*size, lo + (i+1)*size); giá ngoài khoảng dồn vào row đầu / cuối."""
        up, dn = [0.0] * n, [0.0] * n
        sql = ("SELECT CAST((p - ?) / ? + 1e-6 AS INTEGER) AS i, SUM(up), SUM(dn) FROM tickvp "
               "WHERE symbol=? AND t>=? AND t<? GROUP BY i")
        with self._lock:
            rows = self.db.execute(sql, (lo, size, symbol, frm, to)).fetchall()
        for i, u, d in rows:
            k = min(n - 1, max(0, i))
            up[k] += u
            dn[k] += d
        return up, dn

    def upsert(self, symbol: str, tf: str, bars: List[Dict[str, Any]]) -> None:
        rows = [(symbol, tf, int(b["t"]), b["o"], b["h"], b["l"], b["c"], b["v"]) for b in bars]
        with self._lock:
            self.db.executemany("INSERT OR REPLACE INTO bars VALUES (?,?,?,?,?,?,?,?)", rows)
            self.db.commit()

    def query(self, symbol: str, tf: str, frm: Optional[int] = None,
              to: Optional[int] = None, limit: int = 5000) -> List[Dict[str, Any]]:
        """Trả về tối đa `limit` bar mới nhất trong [frm, to), tăng dần theo t."""
        where, params = ["symbol=?", "tf=?"], [symbol, tf]
        if frm is not None:
            where.append("t >= ?"); params.append(frm)
        if to is not None:
            where.append("t < ?"); params.append(to)
        sql = f"SELECT t,o,h,l,c,v FROM bars WHERE {' AND '.join(where)} ORDER BY t DESC LIMIT ?"
        with self._lock:
            rows = self.db.execute(sql, params + [limit]).fetchall()
        return [dict(zip(_COLS, r)) for r in reversed(rows)]

    def last(self, symbol: str, tf: str) -> Optional[Dict[str, Any]]:
        rows = self.query(symbol, tf, limit=1)
        return rows[0] if rows else None

    def archive(self, dest: Path) -> Optional[Path]:
        """Chụp toàn bộ bar ra file `dest` (VACUUM INTO) rồi xoá sạch - dùng khi đổi broker.
        Trả None nếu không có bar nào."""
        with self._lock:
            if self.db.execute("SELECT 1 FROM bars LIMIT 1").fetchone() is None:
                return None
            self.db.execute("VACUUM INTO ?", (str(dest),))
            self.db.execute("DELETE FROM bars")
            self.db.execute("DELETE FROM tickvp")
            self.db.commit()
        return dest


TABLES = ("layouts", "drawings", "scripts", "watchlists", "settings", "symbols")


class MetaStore:
    """SQLite: mỗi bảng lưu document JSON (id, scope, data)."""

    def __init__(self, path: Path = SQLITE_PATH):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.db = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()
        for t in TABLES:
            self.db.execute(
                f"CREATE TABLE IF NOT EXISTS {t} (id TEXT PRIMARY KEY, scope TEXT NOT NULL DEFAULT '', data TEXT NOT NULL)"
            )
        self.db.commit()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        """Giữ lock + commit khi xong, rollback nếu lỗi - cho thao tác nhiều câu lệnh phải đi cùng nhau
        (bảng users/sessions, chuyển dữ liệu cũ sang user)."""
        with self._lock:
            try:
                yield self.db
                self.db.commit()
            except BaseException:
                self.db.rollback()
                raise

    def backup(self, dest: Path) -> Path:
        """Chụp nguyên DB ra `dest` (VACUUM INTO) - sao lưu trước khi đổi hàng loạt."""
        with self._lock:
            self.db.execute("VACUUM INTO ?", (str(dest),))
        return dest

    def list(self, table: str, scope: Optional[str] = None) -> List[Dict[str, Any]]:
        assert table in TABLES
        with self._lock:
            if scope is None:
                cur = self.db.execute(f"SELECT id, scope, data FROM {table}")
            else:
                cur = self.db.execute(f"SELECT id, scope, data FROM {table} WHERE scope=?", (scope,))
            return [{"id": i, "scope": s, "data": json.loads(d)} for i, s, d in cur.fetchall()]

    def get(self, table: str, id: str) -> Optional[Dict[str, Any]]:
        assert table in TABLES
        with self._lock:
            row = self.db.execute(f"SELECT id, scope, data FROM {table} WHERE id=?", (id,)).fetchone()
        return {"id": row[0], "scope": row[1], "data": json.loads(row[2])} if row else None

    def put(self, table: str, id: str, scope: str, data: Any) -> None:
        assert table in TABLES
        with self._lock:
            self.db.execute(
                f"INSERT INTO {table} (id, scope, data) VALUES (?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET scope=excluded.scope, data=excluded.data",
                (id, scope, json.dumps(data)),
            )
            self.db.commit()

    def put_many(self, table: str, rows: List[Tuple[str, str, Any]]) -> None:
        assert table in TABLES
        with self._lock:
            self.db.executemany(
                f"INSERT INTO {table} (id, scope, data) VALUES (?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET scope=excluded.scope, data=excluded.data",
                [(i, s, json.dumps(d)) for i, s, d in rows],
            )
            self.db.commit()

    def delete(self, table: str, id: str) -> None:
        assert table in TABLES
        with self._lock:
            self.db.execute(f"DELETE FROM {table} WHERE id=?", (id,))
            self.db.commit()

    def clear(self, table: str) -> None:
        assert table in TABLES
        with self._lock:
            self.db.execute(f"DELETE FROM {table}")
            self.db.commit()
