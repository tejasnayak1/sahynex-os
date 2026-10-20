#!/usr/bin/env bash
# Starts an isolated, seeded production server + worker for end-to-end tests.
set -euo pipefail
export DATABASE_URL="${E2E_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/sahynex_e2e}"
export SESSION_SECRET="e2e-secret-e2e-secret-e2e-secret-0123456"
export STORAGE_DIR="${E2E_STORAGE_DIR:-/tmp/sahynex-e2e-storage}"
export APP_URL="http://localhost:3100"
export MONITOR_ALLOW_PRIVATE=true
export LOGIN_RATE_LIMIT_IP=10000 LOGIN_RATE_LIMIT_EMAIL=10000
export WORKER_TICK_MS=1000
export MARKET_NEWS_FIXTURE="$PWD/tests/fixtures/market-news.json" # no network in tests
export NODE_ENV=production ALLOW_DEMO_SEED=true
DB="${DATABASE_URL##*/}"
ADMIN="${DATABASE_URL%/*}/postgres"
psql "$ADMIN" -qc "drop database if exists \"$DB\" with (force)" -c "create database \"$DB\"" >/dev/null
rm -rf "$STORAGE_DIR"
npx tsx src/db/migrate.ts
npx tsx src/db/seed.ts >/dev/null
npx tsx src/worker/index.ts > /tmp/sahynex-e2e-worker.log 2>&1 &
WORKER=$!
trap 'kill $WORKER 2>/dev/null || true' EXIT
npx next start -p 3100
