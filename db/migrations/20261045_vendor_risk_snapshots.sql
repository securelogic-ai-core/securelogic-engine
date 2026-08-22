-- 20261045_vendor_risk_snapshots.sql
--
-- Vendor risk trend substrate (VA-7).
--
-- ── WHY THIS TABLE EXISTS ──────────────────────────────────────────────────
-- The Vendor Assurance capability audit found the platform has NO vendor risk
-- history: `vendors.current_risk_score` is overwritten in place on every
-- recompute, so "is this vendor getting better or worse?" is unanswerable and
-- can never be answered retroactively — a snapshot series can only accumulate
-- forward from the day the substrate ships. This is the vendor-dimension twin
-- of `risk_history` (20260816): a derived, recomputable, per-day capture that
-- is NEVER a source of truth (the live values stay on vendors / findings /
-- vendor_engagements; this table only remembers what they were).
--
-- One row per (org, vendor, calendar day); a same-day re-run upserts (the
-- riskHistoryStore convention), so the daily worker and a manual re-sweep
-- converge on the same row instead of duplicating it.
--
-- ── SCORING POLARITY (load-bearing — docs/scoring-vocabulary, and the
--    20260919_vendor_engagements.sql header) ─────────────────────────────────
-- Two score systems are captured side by side and must NEVER be blended:
--
--   legacy_risk_score — copy of vendors.current_risk_score at capture.
--                       NUMERIC, 0-100, HIGHER = BETTER (the frozen legacy
--                       formula in vendorRiskScore.ts). Nullable: a vendor
--                       that has never been scored snapshots as NULL, not 0 —
--                       0 would read as "worst possible", which is a lie.
--   residual_score /  — from the vendor's latest engagement with a computed
--   residual_rating     residual. INTEGER 0-100, HIGHER = WORSE (risk-register
--                       polarity). Nullable: most vendors have no engagement
--                       residual yet, and NULL is the honest value.
--
-- The columns carry both polarities precisely so no reader ever has to invert
-- one into the other; a trend surface plots them as separate series.
--
-- ── WHAT active_findings_count COUNTS ──────────────────────────────────────
-- The canonical Active population (operational_status <> 'closed' — the
-- ratified Active/Closed axis in metricDefinitions.ts) over ALL THREE vendor
-- finding edges: source_type 'vendor_review' (via vendor_assessments),
-- 'vendor_cycle_review' (via vendor_reviews) and 'vendor_engagement' (via
-- vendor_engagements). The store (vendorRiskHistoryStore.ts) owns that union
-- SQL; the column here is just the remembered number.
--
-- ── DELETION SEMANTICS ─────────────────────────────────────────────────────
-- vendor_id cascades: today vendors are archive-only (no hard-delete route),
-- and archiving STOPS new snapshots without erasing the series. If a hard
-- delete ever ships, its governance decision already has to confront evidence
-- erasure platform-wide; an orphaned score series with no vendor row to name
-- would be noise, not evidence, so CASCADE is the correct default here.
--
-- Additive only: creates one table plus policy/grants. No existing table is
-- altered. Empty at birth — zero backfill risk (and backfill is impossible by
-- construction: the history was never recorded anywhere).
--
-- Rollback (manual, forward-only convention): DROP TABLE vendor_risk_snapshots.

CREATE TABLE IF NOT EXISTS vendor_risk_snapshots (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor_id             UUID        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,

  -- The calendar day (UTC, the worker's clock) this capture describes.
  captured_on           DATE        NOT NULL,

  -- vendors.current_risk_score at capture. HIGHER = BETTER (legacy polarity).
  -- NULL = the vendor had no computed score that day; never coalesce to 0.
  legacy_risk_score     NUMERIC(10,2) NULL,

  -- vendors.criticality at capture — criticality changes over time and a trend
  -- reader must know which regime a point was scored under.
  criticality           TEXT        NULL
                          CHECK (criticality IS NULL OR criticality IN ('critical', 'high', 'medium', 'low')),

  -- Canonical Active findings linked to the vendor via all three edges (see
  -- header). 0 is a real measurement here ("we looked, none were active"),
  -- unlike the nullable scores.
  active_findings_count INTEGER     NOT NULL DEFAULT 0
                          CHECK (active_findings_count >= 0),

  -- Latest engagement residual at capture (nullable). HIGHER = WORSE
  -- (risk-register polarity). Same vocabulary/CHECKs as vendor_engagements.
  residual_rating       TEXT        NULL
                          CHECK (residual_rating IS NULL OR residual_rating IN
                            ('Critical', 'High', 'Moderate', 'Low')),
  residual_score        INTEGER     NULL
                          CHECK (residual_score IS NULL OR residual_score BETWEEN 0 AND 100),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One capture per vendor per day; the same-day path is an upsert, never a
  -- duplicate. This constraint's backing index (org, vendor, captured_on) is
  -- exactly the trend read path, so no separate index is needed for reads.
  CONSTRAINT vendor_risk_snapshots_daily_unique
    UNIQUE (organization_id, vendor_id, captured_on)
);

-- ── TENANT ISOLATION (the 20261029 finding_risks pattern) ──────────────────
-- Standard NULLIF-GUC RLS, enabled NOT FORCE: the app_request role is bound by
-- the policy; the owner/elevated channel (worker enumeration, migrations) is
-- not. The WITH CHECK arm is what stops a cross-org write — USING alone would
-- only hide reads. Writes happen inside each org's own withTenant scope, so a
-- bug that mixed orgs in the sweep would be refused by Postgres itself.
ALTER TABLE vendor_risk_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_risk_snapshots_tenant_isolation ON vendor_risk_snapshots;
CREATE POLICY vendor_risk_snapshots_tenant_isolation ON vendor_risk_snapshots
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- SELECT for the trend API, INSERT + UPDATE for the daily upsert. No DELETE:
-- history is refresh-only from the request role — nothing in the product
-- deletes a snapshot, so the grant does not exist to be misused.
GRANT SELECT, INSERT, UPDATE ON vendor_risk_snapshots TO app_request;

COMMENT ON TABLE vendor_risk_snapshots IS
  'Per-vendor per-day risk capture (VA-7 trend substrate). Derived and recomputable for TODAY only — historical rows are the only record of past state. legacy_risk_score is HIGHER = BETTER (frozen legacy formula); residual_score/residual_rating are HIGHER = WORSE (risk-register polarity); the two must never be blended. Written by the daily vendor-risk-history worker inside each org''s tenant scope.';

COMMENT ON COLUMN vendor_risk_snapshots.legacy_risk_score IS
  'vendors.current_risk_score at capture. NUMERIC 0-100, HIGHER = BETTER. NULL = unscored that day (never 0).';

COMMENT ON COLUMN vendor_risk_snapshots.residual_score IS
  'Latest engagement residual at capture. INTEGER 0-100, HIGHER = WORSE. Opposite polarity to legacy_risk_score — never blend or compare the two.';
