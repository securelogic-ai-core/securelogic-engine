-- 20261047_asset_resolution_reviews.sql
--
-- PLAT-ASSET-1 v1: the human review queue for asset-identity resolution.
--
-- AUTHORITY: the PLAT-ASSET-1 operator ruling (2026-08-22): "machines may
-- make deterministic decisions; humans resolve ambiguity. Ambiguous matches,
-- conflicting identities and multiple candidate matches go to the human
-- review queue." This table IS that queue. It is modeled on
-- signal_match_suggestions (20260505) — the platform's one existing
-- machine-proposes/human-decides shape — deliberately, so there is no second
-- decision-state pattern to learn.
--
-- WHAT LANDS HERE (v1, written only by the scan-ingestion intake):
--   ambiguous          — a scanned identifier matched MORE THAN ONE asset in
--                        the alias index. Writing to all would fabricate
--                        exposures; picking one would guess. A human decides.
--   unqualified_strong — a claim in the cloud_resource_id scheme whose value
--                        parses under NO provider-native grammar
--                        (assetStrongIdentity.ts): the source asserted a
--                        strong identity the machine cannot verify as one.
--                        Low volume, genuinely a human question.
--   conflicting_identity — reserved in the CHECK for forward-compatibility;
--                        THE v1 INTAKE CANNOT EMIT IT. The SL-OCC-3 report
--                        contract carries one identifier per asset ref, never
--                        a per-host bundle, so "strong says X, weak says Y"
--                        is structurally unobservable until the contract
--                        grows host bundles. Honest by declaration.
--
-- WHAT DOES NOT LAND HERE (ruled, not forgotten):
--   unmatched-with-only-weak-identifiers. The operator scoped the queue to
--   ambiguity and conflict; a first import of a 5,000-host estate would mint
--   5,000 rows — data entry through a keyhole, not a review queue. Unmatched
--   refs stay counted and named in the import response (SL-OCC-3 behavior,
--   unchanged). Bulk estate population for weak-identified assets is a
--   different package.
--
-- Decision state: exactly one of {pending, accepted, dismissed}, timestamps-
-- encode-state with a CHECK, terminal rows immutable at the route layer
-- (409), partial unique index excludes terminal rows so the intake may
-- re-queue the same identifier after a dismissal. All per the
-- signal_match_suggestions precedent.
--
-- candidate_asset_ids carries NO FK (array); the accept handler MUST verify
-- the chosen asset belongs to the caller's org before attaching — same rule
-- as the suggestion accept handler. accepted_asset_id likewise has no FK,
-- mirroring accepted_link_id (20260505): the audit trail and the created
-- asset_identifiers row are the durable record.
--
-- claims_echo is JSONB by ruling F: it is a SOURCE ECHO ONLY — what the
-- report literally claimed, kept so a reviewer sees the evidence — and is
-- never compliance-load-bearing (the vulnerability_observations.metadata
-- rule, ECL S0). Everything the decision reads is a typed column.
--
-- Tenant isolation: org_id NOT NULL + CASCADE, RLS enabled with the NULLIF
-- GUC pattern (20261033 idiom), tenant-first indexes, writes only inside
-- asTenant scopes. Grants: SELECT/INSERT/UPDATE — UPDATE because accept and
-- dismiss are in-place state transitions; no DELETE, a review is a record.

CREATE TABLE IF NOT EXISTS asset_resolution_reviews (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  kind                  TEXT        NOT NULL CHECK (kind IN (
                          'ambiguous',
                          'conflicting_identity',
                          'unqualified_strong'
                        )),

  -- The identifier under review. scheme mirrors the 20261033 CHECK exactly.
  scheme                TEXT        NOT NULL CHECK (scheme IN (
                          'internal_id', 'hostname', 'fqdn', 'ip', 'mac',
                          'cloud_resource_id', 'instance_id',
                          'application_id', 'scanner_asset_id'
                        )),
  value                 TEXT        NOT NULL CHECK (length(trim(value)) > 0),

  -- WHO reported the identifier and in which run — the same free-text source
  -- vocabulary as vulnerability_scan_runs.source_key (free text BY RULING,
  -- 20261035).
  source_key            TEXT        NOT NULL CHECK (length(trim(source_key)) > 0),
  scan_run_id           UUID        NULL REFERENCES vulnerability_scan_runs(id) ON DELETE SET NULL,

  -- For kind='ambiguous': every asset the identifier matched, at queue time.
  -- No FK by design (array) — org-verified at accept.
  candidate_asset_ids   UUID[]      NOT NULL DEFAULT '{}',

  -- Source echo only (ruling F). Never read by code paths that decide.
  claims_echo           JSONB       NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  accepted_at           TIMESTAMPTZ NULL,
  accepted_by_user_id   UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  accepted_asset_id     UUID        NULL,

  dismissed_at          TIMESTAMPTZ NULL,
  dismissed_by_user_id  UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  dismissal_reason      TEXT        NULL,

  CONSTRAINT asset_resolution_reviews_state_chk CHECK (
    (accepted_at IS NULL     AND dismissed_at IS NULL     AND accepted_asset_id IS NULL)
    OR
    (accepted_at IS NOT NULL AND dismissed_at IS NULL     AND accepted_asset_id IS NOT NULL)
    OR
    (dismissed_at IS NOT NULL AND accepted_at IS NULL     AND accepted_asset_id IS NULL)
  )
);

-- One PENDING review per identifier per source per org. Excludes terminal
-- rows so a re-import after a dismissal may legitimately re-ask. Also the
-- ON CONFLICT inference target for the intake's queue writes — replaying a
-- report must not flood the queue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_resolution_reviews_unique_pending
  ON asset_resolution_reviews (organization_id, source_key, scheme, value)
  WHERE accepted_at IS NULL AND dismissed_at IS NULL;

-- Hot read: the org's pending queue, newest first.
CREATE INDEX IF NOT EXISTS idx_asset_resolution_reviews_org_pending
  ON asset_resolution_reviews (organization_id, created_at DESC)
  WHERE accepted_at IS NULL AND dismissed_at IS NULL;

-- Lookup by identifier (support runbooks: "why is this in review?").
CREATE INDEX IF NOT EXISTS idx_asset_resolution_reviews_lookup
  ON asset_resolution_reviews (organization_id, scheme, value);

ALTER TABLE asset_resolution_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_resolution_reviews_tenant_isolation ON asset_resolution_reviews;
CREATE POLICY asset_resolution_reviews_tenant_isolation ON asset_resolution_reviews
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON asset_resolution_reviews TO app_request;

COMMENT ON TABLE asset_resolution_reviews IS
  'PLAT-ASSET-1 human review queue for asset-identity resolution: ambiguous matches, conflicting identities, and strong-scheme claims that fail grammar validation. Machines never guess — a row here is a question only a human may answer. Modeled on signal_match_suggestions: pending/accepted/dismissed, terminal rows immutable, partial unique excludes terminal rows.';
