-- Migration: gdpr_foundations
-- Package:   GDPR/CCPA Data Subject Rights — PR 1 of N (schema + classification foundation)
-- Workstream: data-subject-rights (GDPR Arts. 15 / 17 / 20 + CCPA equivalents)
--
-- Operator decisions encoded here (Phase 0 enumeration; all 12 locked):
--   O-3  DELETION = TOMBSTONE, not hard-delete. The users row is NEVER deleted.
--        On reap, PII is scrubbed IN PLACE, the row's UUID is preserved, and
--        every foreign key that references the user stays intact. This is what
--        keeps security_audit_log (append-only since 20260614 — a cascade
--        UPDATE to SET NULL would be rejected by its immutability trigger and
--        abort the whole delete) from blocking deletion, and keeps audit-trail
--        attribution UUIDs from being nulled by the ON DELETE SET NULL cascades
--        on the ~25 actor columns across the schema.
--   O-10 Async data-rights work runs on a NEW dedicated data-rights-worker
--        service (added to render.yaml in a later PR) that pulls from the
--        generic `jobs` table created here.
--
-- This PR is schema + docs ONLY. No endpoints, no worker, no UI. The reaper
-- (PR #6) is the sole writer that performs the tombstone and the place where
-- the "users never receives a DELETE" invariant is enforced. This migration
-- only provisions the columns and tracking tables. See docs/DATA_CLASSIFICATION.md.
--
-- ── users lifecycle states (status column) ──────────────────────────────────
-- The `status` column PREDATES this migration: it was created in
-- 001_securelogic_platform.sql as `status TEXT NOT NULL DEFAULT 'active'` with
-- NO CHECK constraint. This migration adds the formal CHECK (new) and two NEW
-- valid states. A whole-repo sweep confirmed the only values ever written to
-- users.status before this PR are 'active' and 'inactive', so the CHECK is safe
-- against existing data. The four valid states:
--   active            Normal user, can authenticate.
--   inactive          Deactivated by admin or auto-deactivated (e.g. team-member
--                     removal via teamInvites.ts), cannot authenticate. NOT
--                     pending deletion. Pre-existing behavior — UNCHANGED by
--                     this PR.
--   pending_deletion  Deletion requested; in the 30-day grace window; cannot
--                     authenticate; cancellable by the data subject (or the
--                     admin, if admin-initiated) until the reaper runs.
--   deleted           Tombstoned: PII scrubbed in place, UUID preserved for
--                     audit-trail integrity. Terminal state.
--
-- ── RLS (A04-G1) ────────────────────────────────────────────────────────────
-- Both new tables (jobs, data_export_files) are org-scoped customer-data, so
-- they ENABLE ROW LEVEL SECURITY with the canonical per-org policy copied
-- verbatim from 20260619_findings_rls_pilot.sql / 20260620_batch_a1_rls_policies
-- — NULLIF(current_setting('app.current_org_id', true), '')::uuid; USING +
-- WITH CHECK; NOT FORCE; no TO clause. (Reference NOTE: legal_consents does NOT
-- use RLS — the canonical pattern is the findings pilot, not legal_consents.)
-- Under Decision A1 these policies are INERT until the DATABASE_URL→app_request
-- flip: the owner role bypasses RLS today. Per Option Y
-- (20260618_create_app_request_role.sql) every new customer-data table MUST be
-- granted to app_request in the same migration that creates it — the Tier A
-- grants below satisfy that. The users column ADDs need NO new grant: users is
-- already Tier A and all grants in this schema are table-level (there are no
-- column-level grants anywhere), so new columns inherit the table grant.
--
-- Idempotent throughout: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS, a pg_constraint guard around the new CHECK, and
-- DROP POLICY IF EXISTS before each CREATE POLICY. GRANT is inherently
-- idempotent. Safe to re-run. Auto-applies on Render deploy via the engine
-- startCommand (npm run migrate). Filename 20260621 keeps the repo's monotonic
-- forward-running sequence (latest prior file is 20260620).

-- ════════════════════════════════════════════════════════════════════════════
-- A. users — tombstone lifecycle columns
-- ════════════════════════════════════════════════════════════════════════════

-- status already exists from 001 (this ADD is a no-op if present); listed for
-- completeness and so a fresh-deploy reading this file sees the column intent.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_requested_by_user_id UUID
    REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_reason               TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at                    TIMESTAMPTZ;

-- Formal CHECK on the pre-existing status column. Guarded by a pg_constraint
-- lookup so the migration is idempotent and never errors if it already exists.
-- deletion_reason intentionally has NO CHECK (soft validation, forward
-- flexibility per O-3 spec); only status is constrained.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_status_check
      CHECK (status IN ('active', 'inactive', 'pending_deletion', 'deleted'));
  END IF;
END
$$;

-- Reaper scan index: efficiently find users whose grace window has expired.
CREATE INDEX IF NOT EXISTS idx_users_pending_deletion
  ON users (status, deletion_scheduled_at)
  WHERE status = 'pending_deletion';

-- ════════════════════════════════════════════════════════════════════════════
-- B. jobs — generic async work queue for the data-rights-worker (O-10)
-- ════════════════════════════════════════════════════════════════════════════
-- Pull pattern: a worker SELECTs (status='queued' AND scheduled_for <= now())
-- ORDER BY scheduled_for, claims via locked_by/locked_at, then transitions
-- status. updated_at is maintained in APPLICATION SQL (repo convention — no DB
-- trigger exists anywhere in this schema; the future worker sets
-- updated_at = now() in its UPDATEs).

CREATE TABLE IF NOT EXISTS jobs (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by_user_id UUID        NULL     REFERENCES users(id)         ON DELETE SET NULL,
  job_type             TEXT        NOT NULL CHECK (job_type IN (
                                     'data_export_self',
                                     'data_export_org',
                                     'account_deletion_reap',
                                     'export_file_purge')),
  status               TEXT        NOT NULL DEFAULT 'queued' CHECK (status IN (
                                     'queued',
                                     'processing',
                                     'succeeded',
                                     'failed',
                                     'dead_lettered')),
  scheduled_for        TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts             INTEGER     NOT NULL DEFAULT 0,
  max_attempts         INTEGER     NOT NULL DEFAULT 5,
  next_attempt_at      TIMESTAMPTZ NULL,
  payload              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  result               JSONB       NULL,
  error                TEXT        NULL,
  locked_by            TEXT        NULL,
  locked_at            TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_scheduled
  ON jobs (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_jobs_org_created
  ON jobs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_requested_by_created
  ON jobs (requested_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_type_status
  ON jobs (job_type, status);

COMMENT ON TABLE jobs IS
  'Generic async work queue pulled by the data-rights-worker (GDPR data-subject-rights workstream, O-10). updated_at is maintained in application SQL — no DB trigger (repo convention).';

-- ════════════════════════════════════════════════════════════════════════════
-- C. data_export_files — generated export bundles + signed-download metadata
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS data_export_files (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                    UUID        NOT NULL REFERENCES jobs(id)          ON DELETE CASCADE,
  organization_id           UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by_user_id      UUID        NULL     REFERENCES users(id)         ON DELETE SET NULL,
  scope                     TEXT        NOT NULL CHECK (scope IN ('user_self', 'org_full')),
  r2_key                    TEXT        NOT NULL,
  file_size_bytes           BIGINT      NULL,
  -- download_token_hash stores the HMAC-SHA256 hash of the download token,
  -- NEVER the raw token. The raw token only ever exists in the emailed download
  -- link (O-9: authenticated app-route + HMAC token; no long-lived presigned
  -- R2 URL in email). The download route looks the file up BY this hash, which
  -- happens before org context is established — that lookup must therefore run
  -- on the elevated/owner channel (pgElevated), see docs/DATA_CLASSIFICATION.md.
  download_token_hash       TEXT        NOT NULL,
  download_token_expires_at TIMESTAMPTZ NOT NULL,
  downloaded_at             TIMESTAMPTZ NULL,
  downloaded_from_ip        INET        NULL,
  purged_at                 TIMESTAMPTZ NULL,   -- when the R2 object was deleted by the purge job (O-11: 7-day lifetime)
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_data_export_files_token_hash
  ON data_export_files (download_token_hash);
CREATE INDEX IF NOT EXISTS idx_data_export_files_org_created
  ON data_export_files (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_export_files_requested_by_created
  ON data_export_files (requested_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_export_files_expires
  ON data_export_files (download_token_expires_at);

COMMENT ON TABLE data_export_files IS
  'Tracks generated GDPR data-export bundles in R2 (7-day lifetime, O-11). download_token_hash = HMAC-SHA256 of the token; the raw token lives only in the email link (O-9).';

-- ════════════════════════════════════════════════════════════════════════════
-- D. RLS + app_request grants (A04-G1 Option Y) — INERT until the flip
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jobs_tenant_isolation ON jobs;

CREATE POLICY jobs_tenant_isolation ON jobs
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE data_export_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS data_export_files_tenant_isolation ON data_export_files;

CREATE POLICY data_export_files_tenant_isolation ON data_export_files
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- Option Y Tier A grants (full DML). app_request is created in
-- 20260618_create_app_request_role.sql, which sorts before this file and so has
-- already run by the time this migration applies.
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs              TO app_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON data_export_files TO app_request;
