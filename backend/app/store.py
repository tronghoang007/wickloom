import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from .config import BARS_DIR, SQLITE_PATH

_SCHEMA = pa.schema([
    ("t", pa.int64()), ("o", pa.float64()), ("h", pa.float64()),
    ("l", pa.float64()), ("c", pa.float64()), ("v", pa.float64()),
])


class BarStore:
    """Parquet phân vùng symbol/tf/year, đọc bằng DuckDB."""

    def __init__(self, root: Path = BARS_DIR):
        self.root = root
        self._lock = threading.Lock()

    def _dir(self, symbol: str, tf: str) -> Path:
        return self.root / quote(symbol, safe="") / tf

    def upsert(self, symbol: str, tf: str, bars: List[Dict[str, Any]]) -> None:
        by_year: Dict[int, List[Dict[str, Any]]] = {}
        for b in bars:
            year = datetime.fromtimestamp(b["t"], tz=timezone.utc).year
            by_year.setdefault(year, []).append(b)
        d = self._dir(symbol, tf)
        with self._lock:
            d.mkdir(parents=True, exist_ok=True)
            for year, items in by_year.items():
                path = d / f"{year}.parquet"
                merged = {r["t"]: r for r in pq.read_table(path).to_pylist()} if path.exists() else {}
                for b in items:
                    merged[b["t"]] = {k: b[k] for k in ("t", "o", "h", "l", "c", "v")}
                rows = [merged[k] for k in sorted(merged)]
                table = pa.Table.from_pylist(rows, schema=_SCHEMA)
                tmp = path.with_suffix(".tmp")
                pq.write_table(table, tmp)
                tmp.replace(path)

    def query(self, symbol: str, tf: str, frm: Optional[int] = None,
              to: Optional[int] = None, limit: int = 5000) -> List[Dict[str, Any]]:
        """Trả về tối đa `limit` bar mới nhất trong [frm, to), tăng dần theo t."""
        d = self._dir(symbol, tf)
        if not d.exists() or not any(d.glob("*.parquet")):
            return []
        where, params = [], []
        if frm is not None:
            where.append("t >= ?"); params.append(frm)
        if to is not None:
            where.append("t < ?"); params.append(to)
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        sql = f"SELECT t,o,h,l,c,v FROM read_parquet(?) {clause} ORDER BY t DESC LIMIT ?"
        with self._lock:
            rows = duckdb.connect().execute(sql, [str(d / "*.parquet")] + params + [limit]).fetchall()
        return [dict(t=r[0], o=r[1], h=r[2], l=r[3], c=r[4], v=r[5]) for r in reversed(rows)]

    def last(self, symbol: str, tf: str) -> Optional[Dict[str, Any]]:
        rows = self.query(symbol, tf, limit=1)
        return rows[0] if rows else None


TABLES = ("layouts", "drawings", "scripts", "watchlists", "settings", "symbols")


class MetaStore:
    """SQLite: mỗi bảng lưu document JSON (id, scope, data)."""

    def __init__(self, path: Path = SQLITE_PATH):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()
        for t in TABLES:
            self.db.execute(
                f"CREATE TABLE IF NOT EXISTS {t} (id TEXT PRIMARY KEY, scope TEXT NOT NULL DEFAULT '', data TEXT NOT NULL)"
            )
        self.db.commit()

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
