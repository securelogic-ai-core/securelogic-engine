-- 20261088_core_assurance_composition.sql
-- Assessment Composition v1 (owner-approved methodology, 2026-09-04).
--
-- Two additive pieces:
--
--   1. The SecureLogic Core Assurance Set becomes a CANONICAL FRAMEWORK
--      VERSION (`securelogic-core-assurance` / `1.0`). This is what lets a
--      tenant's provisioned copy carry `frameworks.framework_key` (the FK
--      target added in 20261068) and what lets the governed crosswalk publish
--      rows for it, so the existing S4 chain reaches the sixteen objectives.
--      Nothing else about the framework is schema: its requirements are
--      ordinary `requirements` rows created per tenant by the existing
--      activation path (frameworkActivation.ts / coreAssuranceProvisioning.ts).
--
--   2. `vendor_engagement_composition_snapshots` — the IMMUTABLE record of
--      what SecureLogic composed for an engagement and why: which Core
--      Assurance objectives applied, which did not and on what facts, which
--      were satisfied by governed evidence, which additional requirements the
--      relationship's facts, obligations and domains added, at what depth,
--      and how the tier's nominal target was met. One row per resolve,
--      append-only, hashed for deterministic reproduction.
--
-- ── Why a snapshot table and not the existing records ─────────────────────
-- `engagement_applicability` (20261065) records ONLY what applied — by owner
-- ruling it must never carry exclusions. `vendor_engagement_scope_items` is
-- replaced on every re-resolve before issue and carries no "not applicable".
-- The audit event is not a customer-readable surface. The customer question
-- this answers — "what did SecureLogic select, and why, before I issue it" —
-- needs a durable, readable, by-value record of the WHOLE composition
-- including what was left out. That is a snapshot, versioned by its own
-- `snapshot_version`, keyed to the scope-rule corpus that produced it.
--
-- Guarded by the SHARED worm_guard_mutation (20261017), never a private copy:
-- the certified-erasure exception lives in that one function.
--
-- Rollback: docs/release/ROLLBACK-20261088.sql

-- ---------------------------------------------------------------
-- 1. Canonical framework identity for the Core Assurance Set
-- ---------------------------------------------------------------
INSERT INTO canonical_framework_versions (framework_key, framework_version, display_name)
VALUES
  ('securelogic-core-assurance', '1.0', 'SecureLogic Core Assurance Set')
ON CONFLICT (framework_key, framework_version) DO NOTHING;

-- ---------------------------------------------------------------
-- 2. Composition snapshots
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_engagement_composition_snapshots (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  engagement_id         UUID         NOT NULL REFERENCES vendor_engagements(id) ON DELETE CASCADE,

  -- Which composition contract wrote this row. Bump when the JSON shape changes.
  snapshot_version      TEXT         NOT NULL,
  -- The STAMPED rule corpus that produced it (1.0.0 / 1.1.0 / 1.2.0 …).
  scope_rule_version    TEXT         NOT NULL,
  -- The Core Assurance Set version in effect, NULL before 1.2.0.
  core_assurance_version TEXT        NULL,
  assessment_tier       TEXT         NOT NULL
                          CONSTRAINT vendor_engagement_composition_snapshots_tier_check
                          CHECK (assessment_tier IN
                            ('tier_1_critical','tier_2_high','tier_3_moderate','tier_4_low')),

  -- The whole composition, BY VALUE. Requirement references and titles as they
  -- were, fact values as they were, evidence basis as it was — never pointers
  -- that a later change can dangle. Safe to render to the customer; it holds
  -- the org's own posture in the aggregate, never a person.
  snapshot              JSONB        NOT NULL
                          CONSTRAINT vendor_engagement_composition_snapshots_shape_check
                          CHECK (jsonb_typeof(snapshot) = 'object'),
  -- sha256 over the canonical JSON of `snapshot` WITHOUT its timestamp, so the
  -- same inputs always hash the same. The reproducibility test asserts it.
  snapshot_hash         TEXT         NOT NULL
                          CONSTRAINT vendor_engagement_composition_snapshots_hash_check
                          CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),

  -- Headline counts, denormalised for list surfaces. The snapshot is the truth.
  asked_count           INTEGER      NOT NULL CHECK (asked_count >= 0),
  evidence_satisfied_count INTEGER   NOT NULL CHECK (evidence_satisfied_count >= 0),
  not_applicable_count  INTEGER      NOT NULL CHECK (not_applicable_count >= 0),
  no_questionnaire_required BOOLEAN  NOT NULL DEFAULT FALSE,

  created_by_user_id    UUID         NULL REFERENCES users(id) ON DELETE SET NULL,
  resolved_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Read path: the latest composition for an engagement, and its history.
CREATE INDEX IF NOT EXISTS idx_vendor_engagement_composition_snapshots_engagement
  ON vendor_engagement_composition_snapshots (organization_id, engagement_id, resolved_at DESC);

COMMENT ON TABLE vendor_engagement_composition_snapshots IS
  'What SecureLogic composed for an engagement and why, by value, one row per '
  'scope resolve. Records the Core Assurance objectives that applied and those '
  'that did not (with the facts read), the requirements added by facts, '
  'obligations and domains, evidence satisfaction with its basis, depth per '
  'item and how the tier target was met. Immutable; hashed for reproduction.';

-- Integrity: the engagement must belong to the same organization.
CREATE OR REPLACE FUNCTION vendor_engagement_composition_snapshots_check_engagement()
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

DROP TRIGGER IF EXISTS vendor_engagement_composition_snapshots_check_engagement
  ON vendor_engagement_composition_snapshots;
CREATE TRIGGER vendor_engagement_composition_snapshots_check_engagement
  BEFORE INSERT OR UPDATE OF engagement_id, organization_id
  ON vendor_engagement_composition_snapshots
  FOR EACH ROW EXECUTE FUNCTION vendor_engagement_composition_snapshots_check_engagement();

-- Append-only, through the shared guard.
DROP TRIGGER IF EXISTS prevent_vendor_engagement_composition_snapshots_row_mutation
  ON vendor_engagement_composition_snapshots;
CREATE TRIGGER prevent_vendor_engagement_composition_snapshots_row_mutation
  BEFORE UPDATE OR DELETE ON vendor_engagement_composition_snapshots
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation('append-only (composition history)');

DROP TRIGGER IF EXISTS prevent_vendor_engagement_composition_snapshots_truncate
  ON vendor_engagement_composition_snapshots;
CREATE TRIGGER prevent_vendor_engagement_composition_snapshots_truncate
  BEFORE TRUNCATE ON vendor_engagement_composition_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation('append-only (composition history)');

ALTER TABLE vendor_engagement_composition_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_engagement_composition_snapshots_tenant_isolation
  ON vendor_engagement_composition_snapshots;
CREATE POLICY vendor_engagement_composition_snapshots_tenant_isolation
  ON vendor_engagement_composition_snapshots
  USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT ON vendor_engagement_composition_snapshots TO app_request;
