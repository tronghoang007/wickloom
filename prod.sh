#!/usr/bin/env bash
# Chạy bản production: backend không --reload, web = next build + next start (nhanh hơn dev, hợp khi vào bằng 4G).
# Dùng: ./prod.sh            build lại web rồi chạy
#       ./prod.sh --no-build dùng bản build sẵn (chỉ khi web/src không đổi từ lần build trước)
#       ./prod.sh --no-mt5   không mở MT5 (mặc định mở MetaTrader 5 chạy wine nếu chưa chạy)
set -e
cd "$(dirname "$0")"
trap 'kill 0' EXIT

# Giải phóng cổng trước (dev.sh / bản prod cũ còn chạy thì tắt luôn).
for port in 8000 3000; do
  pids=$(lsof -iTCP:$port -sTCP:LISTEN -t 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Cổng $port đang bận, tắt tiến trình $pids" >&2
    kill $pids 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      lsof -iTCP:$port -sTCP:LISTEN -t >/dev/null 2>&1 || break
      sleep 0.3
    done
    if lsof -iTCP:$port -sTCP:LISTEN -t >/dev/null 2>&1; then
      kill -9 $(lsof -iTCP:$port -sTCP:LISTEN -t) 2>/dev/null || true
    fi
  fi
done

no_build=0; no_mt5=0
for arg in "$@"; do
  case "$arg" in
    --no-build) no_build=1 ;;
    --no-mt5) no_mt5=1 ;;
  esac
done

if [ "$no_build" = 0 ]; then
  (cd web && npm run build)
fi

(cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000) &
(cd web && npm run start -- -H 127.0.0.1 -p 3000) &

# Mở MT5 (wine) ngay sau khi bật backend để EA nối lại socket; -g = không cướp focus, -j = mở ẩn (không hiện cửa sổ). Đã chạy rồi thì thôi,
# và MT5 không bị tắt theo khi Ctrl+C script này.
if [ "$no_mt5" = 0 ] && ! pgrep -f "MetaTrader 5.app/Contents/MacOS" >/dev/null; then
  open -g -j -a "MetaTrader 5"
fi
wait
