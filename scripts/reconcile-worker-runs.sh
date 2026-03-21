#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/securelogic-engine

set -a
source .env.local
set +a

psql "$DATABASE_URL" <<'SQL'
UPDATE worker_runs
SET status = 'failed',
    completed_at = NOW(),
    duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at))::int * 1000,
    metadata = COALESCE(metadata, '{}'::jsonb) || '{"error":"stale_running_row_reconciled"}'::jsonb
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '5 minutes';
SQL
