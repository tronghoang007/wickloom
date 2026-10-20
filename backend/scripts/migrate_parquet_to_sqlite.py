"""Chép cache bar parquet cũ (data/bars/<symbol>/<tf>/<year>.parquet) sang data/bars.sqlite.

Chỉ ĐỌC parquet (giữ nguyên làm bản sao lưu). INSERT OR IGNORE: bar đã có trong SQLite
(vd EA vừa backfill, là dữ liệu chuẩn của MT5) không bị bản parquet cũ ghi đè.

    .venv/bin/python scripts/migrate_parquet_to_sqlite.py \\
        --drop-before XAUUSDm:M5:2026-02-04T02:20 --drop-before XAUUSDm:M1:2026-10-14T16:39

--drop-before SYMBOL:TF:YYYY-MM-DD[THH:MM] (UTC): bỏ bar cũ hơn mốc đó của series đó (vd
đoạn nến bị gom từ tick lịch sử, không phải bar MT5).
"""
import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import BARS_DB, BARS_DIR  # noqa: E402
from app.store import BarStore  # noqa: E402


def parse_drop(s: str):
    sym, tf, when = s.split(":", 2)
    dt = datetime.fromisoformat(when).replace(tzinfo=timezone.utc)
    return (sym, tf), int(dt.timestamp())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--drop-before", action="append", default=[], type=parse_drop)
    args = ap.parse_args()
    drop = dict(args.drop_before)

    BarStore(BARS_DB)  # tạo bảng nếu chưa có
    db = sqlite3.connect(BARS_DB)
    total = 0
    for tf_dir in sorted(BARS_DIR.glob("*/*")):
        sym, tf = unquote(tf_dir.parent.name), tf_dir.name
        cut = drop.get((sym, tf))
        rows, dropped = [], 0
        for f in sorted(tf_dir.glob("*.parquet")):
            for b in pq.read_table(f).to_pylist():
                if cut is not None and b["t"] < cut:
                    dropped += 1
                    continue
                rows.append((sym, tf, b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]))
        before = db.total_changes
        db.executemany("INSERT OR IGNORE INTO bars VALUES (?,?,?,?,?,?,?,?)", rows)
        db.commit()
        added = db.total_changes - before
        total += added
        print(f"{sym:10} {tf:4} parquet={len(rows) + dropped:6}  bỏ={dropped:6}  thêm={added:6}"
              f"  (đã có sẵn={len(rows) - added})")
    print(f"Xong: thêm {total} bar vào {BARS_DB}")


if __name__ == "__main__":
    main()
