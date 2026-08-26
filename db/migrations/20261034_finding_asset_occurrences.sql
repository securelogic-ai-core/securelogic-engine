-- 20261034_finding_asset_occurrences.sql
--
-- Vulnerability occurrences: one Finding → many affected assets (SL-OCC-1a, 2 of 2).
--
-- Until now a vulnerability could name WHAT it was (SL-VULN-1: cve_id, cwe_id,
-- CVSS) but not WHERE it was. "CVE-2026-10001 affects 17 hosts, 12 still
-- exposed" was unsayable, so the platform could report a vulnerability but not
-- an exposure.
--
-- ── THE CANONICAL RELATIONSHIP, AND WHAT IT IS NOT ────────────────────────
-- An occurrence is the exposure of ONE asset to ONE finding. It is NOT:
--   * a second Findings system — the finding remains the governance object and
--     keeps its severity, SLA, decision_state and operational_status;
--   * a second Risk Register — risks attach to the FINDING via finding_risks;
--     500 affected hosts are one risk, not 500. Nothing here touches risks;
--   * a second remediation or approval workflow — actions, evidence, exceptions
--     and acceptances all continue to hang off the finding;
--   * a per-asset SLA. The due date is a property of the finding under the org
--     policy (resolveSlaDueDate). No requirement in the repo asks for per-asset
--     deadlines and none is invented here.
--
-- ── IDENTITY: (organization_id, finding_id, asset_id) ──────────────────────
-- That triple is what "the same vulnerability on the same asset" means, and it
-- is the ONLY uniqueness this table asserts.
--
-- THERE IS DELIBERATELY NO UNIQUE KEY ON (organization_id, cve_id). The same
-- CVE on fifty hosts is fifty occurrences of ONE finding, and — separately — one
-- CVE may justify more than one finding when it lands in genuinely different
-- product contexts. A unique CVE key would collapse both cases into a single row
-- and destroy the distinction this table exists to make. Which finding a scanner
-- row belongs to is resolved by LOOKUP in the importer (policy, revisable), not
-- by a constraint (schema, permanent).
--
-- ── THREE STATUS AXES, KEPT APART ─────────────────────────────────────────
-- The platform already has two: findings.decision_state (what the organisation
-- DECIDED) and findings.operational_status (where the REMEDIATION got to). This
-- adds a third that belongs to neither: presence — what was OBSERVED, on one
-- asset. Collapsing observation into either of the others is the mistake this
-- separation prevents, because it is what makes a scanner's silence look like a
-- human's decision.
--
--   present     the vulnerability is currently observed on this asset
--   absent      an authoritative later look did NOT find it here
--   remediated  a human recorded that it was fixed here
--
-- `absent` and `remediated` are NOT synonyms and must never be merged: absence
-- is an observation, remediation is a claim about work. SL-VULN-1 established
-- exactly this principle for severity ("Informational" is not "Low"); the same
-- discipline applies to presence.
--
-- NEW and REAPPEARED are deliberately NOT statuses. Both are derivable — NEW is
-- first_seen_at = last_seen_at, REAPPEARED is reappeared_count > 0 — and adding
-- them would be the second status model this design exists to avoid.
--
-- ── ABSENCE NEVER CLOSES THE FINDING ──────────────────────────────────────
-- Nothing in this migration or its routes closes, reopens or re-rates a finding.
-- That inherits ERIP-AD-11 ("drift is reported, never destructive") from the
-- connector observation ledger: an occurrence going absent is a fact about one
-- host, and a finding with any other live occurrence is still live. When every
-- occurrence is absent or remediated the finding becomes ELIGIBLE for closure —
-- surfaced to a human, never applied by the engine.
--
-- ── SCALE ─────────────────────────────────────────────────────────────────
-- DETAIL_ASSET_CAP is 10,000 assets per org, so occurrences are the first table
-- in this domain that can reach six figures per tenant — orders of magnitude
-- larger than findings (5,340 rows in staging today). Every index below is
-- tenant-first so no query can plan a cross-org scan, the active-exposure index
-- is PARTIAL because the overwhelmingly common question is "what is still
-- exposed", and no default Findings list joins this table.

CREATE TABLE IF NOT EXISTS finding_asset_occurrences (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  finding_id            UUID        NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  -- The Tier-0 registry row, never a detail table: EAR-AD-4 makes assets.id the
  -- canonical identity for every asset_type, so one FK covers endpoints, cloud
  -- resources, applications, APIs and identity systems without a polymorphic
  -- column that no foreign key can check.
  -- RESTRICT, not CASCADE. Deleting an asset that carries recorded exposure would
  -- silently erase the vulnerability history for that host — the record of what
  -- it was exposed to, for how long, and whether it was ever fixed. An auditor
  -- asking "what happened to that server" would get nothing, and nobody would
  -- know anything had been lost. The delete route refuses with a 409 and a count
  -- instead, so removing the history is a deliberate act; ordinary retirement is
  -- a lifecycle_status change ('archived'/'retired'), which preserves everything.
  asset_id              UUID        NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,

  presence_status       TEXT        NOT NULL DEFAULT 'present'
    CHECK (presence_status IN ('present', 'absent', 'remediated')),

  -- What the SOURCE observed. first_seen_at is never rewritten once set — an
  -- occurrence that goes absent and returns is the SAME exposure with a gap, and
  -- resetting its origin would erase the very history recurrence reporting needs.
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  absent_since          TIMESTAMPTZ NULL,
  remediated_at         TIMESTAMPTZ NULL,
  remediated_by_user_id UUID        NULL REFERENCES users(id) ON DELETE SET NULL,

  -- Recurrence, as counters rather than states (see above).
  reappeared_count      INTEGER     NOT NULL DEFAULT 0 CHECK (reappeared_count >= 0),
  last_reappeared_at    TIMESTAMPTZ NULL,

  -- Provenance for the occurrence itself. NULL for a manually recorded one —
  -- a human linking a known vulnerability to a known host is a first-class,
  -- permanently supported path, not a degraded import.
  source                TEXT        NULL,
  source_occurrence_id  TEXT        NULL,

  created_by_user_id    UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT occurrence_seen_window CHECK (last_seen_at >= first_seen_at),
  -- The status columns must agree with the status. A row claiming 'absent' with
  -- no absent_since cannot be reported on truthfully, and one claiming 'present'
  -- while still carrying absent_since is a half-applied transition.
  CONSTRAINT occurrence_absent_stamped CHECK (
    (presence_status = 'absent') = (absent_since IS NOT NULL)
  ),
  CONSTRAINT occurrence_remediated_stamped CHECK (
    (presence_status = 'remediated') = (remediated_at IS NOT NULL)
  ),
  CONSTRAINT occurrence_reappeared_stamped CHECK (
    (reappeared_count = 0) = (last_reappeared_at IS NULL)
  ),

  UNIQUE (organization_id, finding_id, asset_id)
);

-- "Which assets does this finding affect?" — served by the unique key's leading
-- (organization_id, finding_id) columns, with presence included so the counts
-- shown on a finding (affected / active / no longer observed) are index-only.
CREATE INDEX IF NOT EXISTS idx_occurrences_finding_presence
  ON finding_asset_occurrences (organization_id, finding_id, presence_status);

-- "Which vulnerabilities affect this asset?" — the inverse view.
CREATE INDEX IF NOT EXISTS idx_occurrences_asset_presence
  ON finding_asset_occurrences (organization_id, asset_id, presence_status);

-- The active-exposure queue. PARTIAL: 'present' is the only status anyone pages
-- through at volume, and indexing resolved history would grow the index without
-- ever being read by that query.
CREATE INDEX IF NOT EXISTS idx_occurrences_active
  ON finding_asset_occurrences (organization_id, last_seen_at DESC)
  WHERE presence_status = 'present';

ALTER TABLE finding_asset_occurrences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finding_asset_occurrences_tenant_isolation ON finding_asset_occurrences;
CREATE POLICY finding_asset_occurrences_tenant_isolation ON finding_asset_occurrences
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- UPDATE is granted because presence legitimately transitions in place; DELETE
-- because a mis-linked occurrence must be correctable. Deleting one occurrence
-- removes ONE asset's exposure record and nothing else: the finding, its other
-- occurrences, its risk links and its history in security_audit_log all survive.
GRANT SELECT, INSERT, UPDATE, DELETE ON finding_asset_occurrences TO app_request;

COMMENT ON TABLE finding_asset_occurrences IS
  'The exposure of one asset to one finding. Identity is (organization_id, finding_id, asset_id) — deliberately NOT (organization_id, cve_id), because one CVE on fifty hosts is fifty occurrences of one finding. Carries the PRESENCE axis only (present/absent/remediated), which is independent of findings.decision_state and findings.operational_status. Absence is an observation and never closes a finding.';
COMMENT ON COLUMN finding_asset_occurrences.presence_status IS
  'What was OBSERVED on this asset: present | absent | remediated. Independent of the finding''s decision_state and operational_status. `absent` (an authoritative later look did not find it) and `remediated` (a human says it was fixed) are NOT synonyms and are never merged.';
COMMENT ON COLUMN finding_asset_occurrences.first_seen_at IS
  'When this exposure was first observed. NEVER rewritten — an occurrence that goes absent and returns is the same exposure with a gap, tracked by reappeared_count.';
