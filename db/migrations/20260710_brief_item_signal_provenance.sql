-- Migration: brief_item_signal_provenance
-- Priority 4 / Phase 4D / story D1 — additive provenance edge table (SCHEMA ONLY).
--
-- intelligence_brief_items already carries ONE cyber_signal_id (the CANONICAL
-- signal). When the brief collapses a cluster (the CVE merge, or the C3b
-- fingerprint merge), the NON-canonical corroborating signals are surfaced in
-- content_json but are NOT persisted as queryable lineage. This table records
-- the full edge set: brief_item -> each contributing cyber_signal, tagged with
-- its relation and the cluster it belonged to.
--
-- D1 is SCHEMA ONLY and INERT: nothing writes or reads this table. Population
-- during brief generation is slice D2; no worker / clustering / brief code
-- changes here.
--
-- Org-owned: organization_id is NOT NULL (REFERENCES organizations ON DELETE
-- CASCADE), mirroring intelligence_brief_items. RLS is enabled from creation
-- (NOT FORCE — owner bypasses; INERT until the A04-G1 app_request flip). Safe to
-- enable now because D1 ships NO writer; D2's populate MUST run inside a
-- withTenant() scope to preserve the "policy => writers wrapped" invariant.
--
-- The cyber_signal reference is ON DELETE SET NULL and `source_slug` is
-- denormalised, so the provenance record survives signal cleanup / GDPR purge.
--
-- Additive + idempotent. Reversible: DROP TABLE intelligence_brief_item_provenance;

CREATE TABLE IF NOT EXISTS intelligence_brief_item_provenance (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brief_item_id    UUID        NOT NULL REFERENCES intelligence_brief_items(id) ON DELETE CASCADE,
  -- Nullable + SET NULL so the lineage row outlives the signal it points to.
  cyber_signal_id  UUID        REFERENCES cyber_signals(id) ON DELETE SET NULL,
  -- Denormalised source slug — provenance ("corroborated by bleepingcomputer")
  -- survives even if the cyber_signal row is later purged.
  source_slug      TEXT,
  -- The cluster this edge belonged to (cve:… / fp:…), for grouping/audit.
  cluster_key      TEXT,
  relation         TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT brief_item_provenance_relation_check
    CHECK (relation IN ('canonical', 'corroborating')),
  -- One edge per (brief_item, signal); guards D2 against duplicate inserts.
  CONSTRAINT brief_item_provenance_unique UNIQUE (brief_item_id, cyber_signal_id)
);

-- RLS-aligned lookup (org + brief item) and reverse lookup (signal -> briefs).
CREATE INDEX IF NOT EXISTS idx_brief_item_provenance_org_item
  ON intelligence_brief_item_provenance (organization_id, brief_item_id);
CREATE INDEX IF NOT EXISTS idx_brief_item_provenance_signal
  ON intelligence_brief_item_provenance (cyber_signal_id);

-- Tenant isolation — identical pattern to the signal-/risk-link RLS siblings.
-- NOT FORCE: owner bypasses (INERT until the app_request flip); NULLIF guards the
-- pooled app_request '' GUC so it fails CLOSED to zero rows, never a 500.
ALTER TABLE intelligence_brief_item_provenance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brief_item_provenance_tenant_isolation ON intelligence_brief_item_provenance;

CREATE POLICY brief_item_provenance_tenant_isolation ON intelligence_brief_item_provenance
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
