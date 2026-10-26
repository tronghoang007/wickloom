#!/usr/bin/env bash
# Chạy bản production: backend không --reload, web = next build + next start (nhanh hơn dev, hợp khi vào bằng 4G).
# Dùng: ./prod.sh            build lại web rồi chạy
#       ./prod.sh --no-build dùng bản build sẵn (chỉ khi web/src không đổi từ lần build trước)
set -e
cd "$(dirname "$0")"
trap 'kill 0' EXIT

for port in 8000 3000; do
  if lsof -iTCP:$port -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Cổng $port đang bận (dev.sh còn chạy?). Dừng nó trước rồi chạy lại." >&2
    exit 1
  fi
done

if [ "$1" != "--no-build" ]; then
  (cd web && npm run build)
fi

(cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000) &
(cd web && npm run start -- -H 127.0.0.1 -p 3000) &
wait
