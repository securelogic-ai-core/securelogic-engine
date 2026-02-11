#!/usr/bin/env bash
set -euo pipefail

echo "== SecureLogic Dev Up =="

# Always run from repo root
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---------------------------------------------------------
# 0) Load local dev env (enterprise dev standard)
# ---------------------------------------------------------
if [[ -f ".env.local" ]]; then
  echo "-> Loading .env.local"
  set -a
  # shellcheck disable=SC1091
  source ".env.local"
  set +a
else
  echo "-> No .env.local found (ok)"
fi

# ---------------------------------------------------------
# 1) Kill anything on port 4000 (clean start)
# ---------------------------------------------------------
echo "-> Killing anything on :4000"
lsof -ti :4000 | xargs -r kill -9 || true

# ---------------------------------------------------------
# 2) Start Redis if it's not running
# ---------------------------------------------------------
if redis-cli ping >/dev/null 2>&1; then
  echo "-> Redis already running"
else
  echo "-> Starting Redis"
  redis-server --daemonize yes >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------
# 3) Required env vars (FAIL CLOSED)
# ---------------------------------------------------------
: "${SECURELOGIC_ADMIN_KEY:?SECURELOGIC_ADMIN_KEY is not set (set it in .env.local)}"
: "${SECURELOGIC_SIGNING_SECRET:?SECURELOGIC_SIGNING_SECRET is not set (set it in .env.local)}"

# ---------------------------------------------------------
# 4) Recommended dev defaults
# ---------------------------------------------------------
export NODE_ENV="${NODE_ENV:-development}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export SECURELOGIC_ADMIN_ALLOWED_IPS="${SECURELOGIC_ADMIN_ALLOWED_IPS:-127.0.0.1/32}"
export PORT="${PORT:-4000}"

echo "-> Starting server"
echo "   NODE_ENV=$NODE_ENV"
echo "   REDIS_URL=$REDIS_URL"
echo "   PORT=$PORT"
echo "   ADMIN_ALLOWED_IPS=$SECURELOGIC_ADMIN_ALLOWED_IPS"

# ---------------------------------------------------------
# 5) Start server WITHOUT recursion
# ---------------------------------------------------------
npm run dev:server