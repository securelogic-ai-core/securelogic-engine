#!/usr/bin/env bash
#
# harness-db-up.sh — local throwaway Postgres for the cross-org isolation
# harness (audit finding E1-G1).
#
# Starts (or reuses) a Docker Postgres container and prints the
# TEST_DATABASE_URL that test/isolation/testDb.ts expects. This is the local
# equivalent of the Postgres service container the `cross-org-isolation` CI
# job provisions; vitest.isolation.config.ts documents both paths.
#
# THROWAWAY DATABASE. testDb.ts drops and recreates the `public` schema on
# every run. Never point TEST_DATABASE_URL at staging or production —
# testDb.ts independently refuses any URL matching /staging|prod/i, but do
# not rely on that as the only guard.
#
# Idempotent: safe to re-run. An already-running container is reused, a
# stopped one is restarted, and only a missing one is created.
#
# Skip-clean: if Docker is not installed or its daemon is unreachable, the
# script prints guidance and exits 0 — it does NOT fail a `&&` chain. In that
# case supply TEST_DATABASE_URL yourself (e.g. from a local Postgres install).
#
# Usage:
#   eval "$(scripts/harness-db-up.sh)"      # export TEST_DATABASE_URL into the shell
#   scripts/harness-db-up.sh && npm run test:isolation
#
# Progress and guidance go to stderr; the single `export TEST_DATABASE_URL=...`
# line is the only thing written to stdout, so `eval "$(...)"` is safe.
#
# All settings below are overridable via the matching HARNESS_DB_* env var.

set -euo pipefail

CONTAINER="${HARNESS_DB_CONTAINER:-securelogic-harness-pg}"
HOST_PORT="${HARNESS_DB_PORT:-55432}"
DB_NAME="${HARNESS_DB_NAME:-harness}"
DB_USER="${HARNESS_DB_USER:-harness}"
DB_PASS="${HARNESS_DB_PASSWORD:-harness}"
PG_IMAGE="${HARNESS_DB_IMAGE:-postgres:16-alpine}"
READY_TIMEOUT="${HARNESS_DB_READY_TIMEOUT:-60}"

# Shape matches test/isolation/testDb.ts (reads TEST_DATABASE_URL, ssl:false).
TEST_DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:${HOST_PORT}/${DB_NAME}"

log() { echo "[harness-db] $*" >&2; }

# ---- skip-clean: no usable Docker -> exit 0, nothing on stdout -------------
if ! command -v docker >/dev/null 2>&1; then
  log "Docker is not installed — skipping container bootstrap (skip-clean)."
  log "To run the harness, supply TEST_DATABASE_URL yourself, e.g.:"
  log "  export TEST_DATABASE_URL='postgresql://user:pass@127.0.0.1:5432/harness_throwaway'"
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  log "Docker is installed but its daemon is unreachable — skipping (skip-clean)."
  log "Start Docker, or supply TEST_DATABASE_URL yourself (see above)."
  exit 0
fi

# ---- idempotent bring-up ---------------------------------------------------
existing="$(docker ps -aq --filter "name=^/${CONTAINER}$")"

if [ -n "${existing}" ]; then
  running="$(docker ps -q --filter "name=^/${CONTAINER}$")"
  if [ -n "${running}" ]; then
    log "Container '${CONTAINER}' is already running — reusing it."
  else
    log "Container '${CONTAINER}' exists but is stopped — starting it."
    docker start "${CONTAINER}" >/dev/null
  fi
else
  log "Creating container '${CONTAINER}' (${PG_IMAGE}), bound to 127.0.0.1:${HOST_PORT}."
  docker run -d \
    --name "${CONTAINER}" \
    -e POSTGRES_USER="${DB_USER}" \
    -e POSTGRES_PASSWORD="${DB_PASS}" \
    -e POSTGRES_DB="${DB_NAME}" \
    -p "127.0.0.1:${HOST_PORT}:5432" \
    "${PG_IMAGE}" >/dev/null
fi

# ---- wait for readiness ----------------------------------------------------
log "Waiting for Postgres to accept connections (timeout ${READY_TIMEOUT}s)..."
deadline=$(( SECONDS + READY_TIMEOUT ))
until docker exec "${CONTAINER}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; do
  if [ "${SECONDS}" -ge "${deadline}" ]; then
    log "ERROR: Postgres did not become ready within ${READY_TIMEOUT}s."
    log "Inspect with: docker logs ${CONTAINER}"
    exit 1
  fi
  sleep 1
done

log "Postgres is ready."
log "TEST_DATABASE_URL=${TEST_DATABASE_URL}"
echo "export TEST_DATABASE_URL='${TEST_DATABASE_URL}'"
