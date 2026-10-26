#!/usr/bin/env bash
# Dùng: ./dev.sh            chạy backend --reload + web dev, và mở MetaTrader 5 (wine) nếu chưa chạy
#       ./dev.sh --no-mt5   không mở MT5
set -e
cd "$(dirname "$0")"
trap 'kill 0' EXIT
(cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload) &
(cd web && npm run dev) &

# Mở MT5 ngay sau khi bật backend để EA nối lại socket; -g = không cướp focus, -j = mở ẩn (không hiện cửa sổ). Đã chạy rồi thì thôi,
# và MT5 không bị tắt theo khi Ctrl+C script này.
if [ "$1" != "--no-mt5" ] && ! pgrep -f "MetaTrader 5.app/Contents/MacOS" >/dev/null; then
  open -g -j -a "MetaTrader 5"
fi
wait
