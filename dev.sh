#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
trap 'kill 0' EXIT
(cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload) &
(cd web && npm run dev) &
wait
