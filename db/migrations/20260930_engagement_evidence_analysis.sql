-- Migration: engagement_evidence_analysis
--
-- The AI-assist layer of Phase 4: each vendor-uploaded evidence document is
-- analysed against the control it was attached to, and the result is recorded
-- as a SUGGESTION for the reviewer.
--
-- ── The ratified boundary, enforced by shape ────────────────────────────────
-- Analysis rows are advisory. Nothing reads them into a score: the
-- effectiveness ladder moves ONLY on the reviewer's confirmation
-- (evidence.reviewed_at, set by a human through the review route). What the
-- analysis DOES feed is `analysis_coverage` — the honest stamp of how much of
-- the evidence a model actually read — and the reviewer's queue, where a
-- 'contradicts' suggestion is a flag to look closely, not a verdict.
--
-- One analysis per evidence file (UNIQUE) — the idempotency anchor for the
-- durable job: a reclaim-after-commit re-run must land on the existing row.

CREATE TABLE IF NOT EXISTS evidence_analysis (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  evidence_id      UUID        NOT NULL UNIQUE REFERENCES evidence(id) ON DELETE CASCADE,
  engagement_id    UUID        NOT NULL REFERENCES vendor_engagements(id) ON DELETE CASCADE,
  requirement_id   UUID        NULL REFERENCES requirements(id) ON DELETE SET NULL,

  -- 'supports'     the document plausibly evidences the control
  -- 'insufficient' readable, but does not establish the control
  -- 'contradicts'  the document suggests the control is NOT in place
  -- 'unreadable'   a type or content automated analysis cannot read (image-only
  --                PDF, spreadsheet, ...) — an honest "a human must read this",
  --                which still COUNTS as analysed for coverage purposes
  verdict          TEXT        NOT NULL CHECK (verdict IN
                     ('supports', 'insufficient', 'contradicts', 'unreadable')),
  rationale        TEXT        NOT NULL,
  model_id         TEXT        NOT NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The reviewer's engagement view: all suggestions for an engagement at once.
CREATE INDEX IF NOT EXISTS idx_evidence_analysis_engagement
  ON evidence_analysis (organization_id, engagement_id);

-- Tenant isolation, matching the Tier B pattern (NOT FORCE: the elevated
-- channel and migrations bypass by ownership).
ALTER TABLE evidence_analysis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evidence_analysis_tenant_isolation ON evidence_analysis;
CREATE POLICY evidence_analysis_tenant_isolation ON evidence_analysis
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- New durable job type for the analysis worker. Additive only.
ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_job_type_check;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_job_type_check
    CHECK (job_type IN (
      'data_export_self',
      'data_export_org',
      'account_deletion_reap',
      'export_file_purge',
      'vendor_assurance_extract',
      'applicability_reassess',
      'connector_sync',
      'vendor_evidence_analysis'
    ));
