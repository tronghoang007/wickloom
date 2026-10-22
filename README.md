# Wickloom

Chart kiểu TradingView chạy local, dữ liệu lấy từ MetaTrader 5.

```
MT5 + EA TVBridge ──TCP :8001 (NDJSON)──> backend FastAPI ──HTTP/WS :8000──> web Next.js :3000
   (bar, tick)                              (SQLite cache)                    (lightweight-charts)
```

- `ea/TVBridge.mq5`: EA đẩy symbols, tick realtime và bar lịch sử (backfill theo yêu cầu) sang backend.
- `backend/`: nhận dữ liệu từ EA, gom tick thành nến, lưu bar vào `data/bars.sqlite`, lưu layout/drawings/watchlist… vào `data/meta.sqlite`, phục vụ `/bars`, `/backfill`, `/ws` và các bảng CRUD.
- `web/`: giao diện chart (Next.js). Kéo chart về quá khứ thì tự xin EA nạp thêm lịch sử.

## Chạy

```bash
# lần đầu
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..
cd web && npm install && cd ..

./dev.sh   # backend :8000 + web :3000
```

EA (MT5 chạy qua Wine trên macOS):

1. Chép `ea/TVBridge.mq5` vào `MQL5/Experts/` của MT5, mở MetaEditor, bấm **F7**.
2. MT5: Tools → Options → Expert Advisors → "Allow WebRequest for listed URL": thêm `127.0.0.1:8001` (MT5 áp whitelist này cho cả socket).
3. Gắn EA vào một chart bất kỳ. Log Experts phải có `TVBridge vX.YY: da ket noi 127.0.0.1:8001`.

## Test

```bash
cd backend && .venv/bin/python -m pytest -q tests
cd web && npx tsc --noEmit && npx eslint .
```

## Dữ liệu

- `backend/data/` không commit. Xoá `bars.sqlite` thì bar sẽ tự nạp lại từ MT5 khi mở chart.
- Khi đổi broker, toàn bộ bar được sao lưu sang `bars_archive_<ts>.sqlite` rồi nạp lại từ đầu.
