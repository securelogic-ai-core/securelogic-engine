-- Migration: engagement_applicability
-- Package:   VA-926 — the applicability record (slot 20261065, owner-reserved)
--
-- Separates APPLICABILITY from QUESTIONNAIRE COMPOSITION.
--
-- ── The defect ──────────────────────────────────────────────────────────────
--
-- A rule's activation is recorded only on the ITEMS it contributed
-- (`vendor_engagement_scope_items.reasons`). When composition truncates every
-- one of those items, the stored scope contains no evidence the rule ever
-- fired. Proven live on staging `876bdcd8`: six tier-4 engagements where
-- S5.privacy.personal_data, S5.ai.declared and S5.nth.third_party_models all
-- activated and the stored scope records none of them.
--
-- The owner ruling this satisfies: truncation alone may never produce
-- "applicable requirement → no evidence → no question → INVISIBLE assurance
-- gap". And for S3 specifically: an applicable regulatory obligation cannot
-- disappear because its question was truncated — without putting every S3
-- question into FLOOR_RULE_IDS.
--
-- ── What is here, and what is deliberately NOT ──────────────────────────────
--
-- PERSISTED (immutable): the rule, the domain, the matched requirement (id AND
-- its reference id as it was), the triggering basis as VALUES, the resolver
-- version, tenant, engagement, and when. All of it is unrecomputable later:
-- rules are versioned code, `scope_tags` are mutable (63 rows were retagged on
-- 2026-08-29 alone), facts supersede, obligations deactivate.
--
-- NOT PERSISTED (derived from current state, by owner ruling):
--   * represented by a question   — the scope items ARE that answer
--   * truncated from composition  — derivable: applicable ∧ ∉ scope items
--   * assurance-covered           — changes after the resolve
--   * remaining assurance gap     — must be computed against CURRENT evidence
--
-- EXCLUDED / NON-APPLICABLE REQUIREMENTS ARE NOT RECORDED (owner ruling). This
-- table is authoritative for WHAT APPLIED AND WHY. It is not a negative-
-- knowledge ledger and not an event log.
--
-- ── Idempotency and history ─────────────────────────────────────────────────
--
-- The unique key includes `basis_hash`, so:
--   * re-resolving with unchanged inputs inserts NOTHING (ON CONFLICT DO
--     NOTHING at the writer) — repeated resolves do not churn history;
--   * a resolve whose basis CHANGED appends a new row and leaves the old one
--     untouched, which is what makes reassessment legible.
--
-- Rows are immutable: a trigger refuses UPDATE and DELETE. History cannot be
-- rewritten, including by the code that wrote it.
--
-- Rollback: docs/release/ROLLBACK-20261065.sql
-- Idempotent and re-runnable.

CREATE TABLE IF NOT EXISTS engagement_applicability (
  id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  engagement_id             UUID         NOT NULL REFERENCES vendor_engagements(id) ON DELETE CASCADE,

  rule_id                   TEXT         NOT NULL
                              CONSTRAINT engagement_applicability_rule_id_check
                              CHECK (rule_id ~ '^S[1-5]\.[a-z0-9_.]+$'),
  rule_family               TEXT         NOT NULL
                              CONSTRAINT engagement_applicability_rule_family_check
                              CHECK (rule_family IN ('S1','S2','S3','S4','S5')),
  -- NULL under 1.0.0, which has no domain rule at all. The CHECK is the same
  -- closed set as `vendor_engagement_scope_items.domain` (20261062) and
  -- `ASSESSMENT_DOMAINS`; a lockstep test reads it from pg_constraint.
  domain                    TEXT         NULL
                              CONSTRAINT engagement_applicability_domain_check
                              CHECK (domain IS NULL OR domain IN
                                ('security','privacy','ai','resilience','nth_party','compliance')),

  -- RESTRICT, not CASCADE: deleting a requirement must not silently erase the
  -- record that it once applied. The reference id is ALSO stored because
  -- reference data is mutable and this record has to reproduce.
  requirement_id            UUID         NOT NULL REFERENCES requirements(id) ON DELETE RESTRICT,
  requirement_reference_id  TEXT         NOT NULL,

  -- Why it applied, as VALUES. A pointer to a fact row would dangle the moment
  -- that fact is superseded; an obligation id alone would dangle when the
  -- obligation is deactivated.
  basis                     JSONB        NOT NULL
                              CONSTRAINT engagement_applicability_basis_check
                              CHECK (jsonb_typeof(basis) = 'object'),
  basis_hash                TEXT         NOT NULL
                              CONSTRAINT engagement_applicability_basis_hash_check
                              CHECK (basis_hash ~ '^[0-9a-f]{64}$'),

  scope_rule_version        TEXT         NOT NULL,
  resolved_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Idempotency: the same determination, re-derived, is the same row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_engagement_applicability_determination
  ON engagement_applicability
     (organization_id, engagement_id, rule_id, requirement_id, basis_hash, scope_rule_version);

-- Read path 1: everything that applied to this engagement.
CREATE INDEX IF NOT EXISTS idx_engagement_applicability_engagement
  ON engagement_applicability (engagement_id, resolved_at DESC);

-- Read path 2: "which engagements had privacy apply", per tenant.
CREATE INDEX IF NOT EXISTS idx_engagement_applicability_org_domain
  ON engagement_applicability (organization_id, domain)
  WHERE domain IS NOT NULL;

COMMENT ON TABLE engagement_applicability IS
  'WHAT APPLIED and WHY, recorded at resolve time and independent of what the '
  'questionnaire ended up asking. Truncation cannot erase it. Immutable. Does '
  'NOT record what was excluded, whether a question represented it, whether it '
  'was truncated, or whether it is assurance-covered — those are derived from '
  'current state (owner ruling 2026-08-29).';

-- ---------------------------------------------------------------
-- Integrity: the engagement must belong to the same organization
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION engagement_applicability_check_engagement()
RETURNS TRIGGER AS $$
DECLARE
  ok BOOLEAN;
BEGIN
  SELECT TRUE INTO ok
    FROM vendor_engagements e
   WHERE e.id = NEW.engagement_id
     AND e.organization_id = NEW.organization_id
   LIMIT 1;

  IF ok IS NULL THEN
    RAISE EXCEPTION 'engagement does not exist in this organization'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS engagement_applicability_check_engagement ON engagement_applicability;
CREATE TRIGGER engagement_applicability_check_engagement
  BEFORE INSERT OR UPDATE OF engagement_id, organization_id ON engagement_applicability
  FOR EACH ROW EXECUTE FUNCTION engagement_applicability_check_engagement();

-- ---------------------------------------------------------------
-- Immutability: history cannot be rewritten, including by us
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION engagement_applicability_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'engagement_applicability rows are immutable (% attempted)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS engagement_applicability_no_update ON engagement_applicability;
CREATE TRIGGER engagement_applicability_no_update
  BEFORE UPDATE OR DELETE ON engagement_applicability
  FOR EACH ROW EXECUTE FUNCTION engagement_applicability_immutable();

-- ---------------------------------------------------------------
-- Tenant isolation
-- ---------------------------------------------------------------
-- ENABLE, not FORCE — matching 20261063's ruling: the elevated channel
-- (erasure, export, migrations) must be able to bypass.
ALTER TABLE engagement_applicability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engagement_applicability_tenant_isolation ON engagement_applicability;
CREATE POLICY engagement_applicability_tenant_isolation ON engagement_applicability
  USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT ON engagement_applicability TO app_request;
-- Deliberately NO UPDATE and NO DELETE grant: the immutability trigger is the
-- second line, not the only one.
