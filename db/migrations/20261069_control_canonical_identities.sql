-- Migration: control_canonical_identities
-- Package:   VA-S4 Step 1 — canonical control identity foundation (slot 20261069)
-- Docs:      docs/design/VA-CANONICAL-CONTROL-IDENTITY-reconciliation.md §4.1(c)
--
-- The TENANT side of the canonical control relationship, mirroring
-- `asset_product_identities` (20260905) — which is the same problem already
-- solved once: link a tenant object to a global canonical entity, record HOW
-- the link was established, and make human attestation structurally distinct
-- from machine inference.
--
-- ── What the owner ruling requires this table to represent ─────────────────
--
-- Three states must be distinguishable, and the third must be a POSITIVE fact
-- rather than an absence with no trace:
--
--   * SecureLogic canonical control instantiated by a tenant
--       -> a row here, provenance 'template' | 'attestation' | 'customer_mapped'
--   * a tenant/customer-specific control
--       -> NO row here. Legitimate, and deliberately representable: the ruling
--          forbids manufacturing false canonical mappings for arbitrary
--          customer controls
--   * a legacy/template-derived control awaiting canonical reconciliation
--       -> a row with provenance 'inferred', which says "matched weakly, nobody
--          stood behind it". Never silently equal to evidence
--
-- ── Many-to-many, deliberately ─────────────────────────────────────────────
--
-- A tenant control may implement more than one canonical control, and a
-- canonical control may be implemented by several tenant controls. That is the
-- second half of the reason this is a table and not
-- `controls.canonical_control_key`.
--
-- ── Tenant data, therefore RLS ─────────────────────────────────────────────
--
-- This is the ONE table in the Step 1 package that holds tenant data, and it
-- carries organization_id, RLS and a policy. The three global tables (20261067,
-- 20261068) carry none, because they hold none. Same NULLIF GUC pattern as
-- `asset_product_identities` / `assets` / `enterprise_entities`; ENABLE, not
-- FORCE, consistent with the rest of the estate.
--
-- DARK + ADDITIVE + REVERSIBLE: one new table, no writes to existing tables, no
-- backfill. Rollback: docs/release/ROLLBACK-20261069.sql
-- Idempotent and re-runnable.

CREATE TABLE IF NOT EXISTS control_canonical_identities (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- The tenant control. RESTRICT rather than CASCADE, matching
  -- `control_mappings.control_id`: a control that carries a canonical identity
  -- used in an assurance decision must not vanish silently underneath it.
  control_id            UUID        NOT NULL REFERENCES controls(id) ON DELETE RESTRICT,

  canonical_control_id  UUID        NOT NULL
                                    REFERENCES canonical_controls(id) ON DELETE RESTRICT,

  -- HOW the link was established. Ordered by authority:
  --   attestation     — a human in this tenant explicitly declared it
  --   template        — an industry template instantiated it, resolved through
  --                     canonical_control_aliases from TemplateControl.id
  --   customer_mapped — the customer mapped their own control to a canonical
  --                     one (Ruling 2: customers strengthen, never narrow)
  --   inferred        — a weak/heuristic match, recorded so that weak is
  --                     VISIBLE as weak rather than silently equal to evidence
  provenance            TEXT        NOT NULL,

  -- 0-100. Consumers rank on it; no consumer exists yet.
  confidence            INTEGER     NOT NULL DEFAULT 100,

  -- What the evidence actually was, for explainability. Free text by design:
  -- a template control id, a curation pass label, a review reference.
  evidence_ref          TEXT        NULL,

  -- Set only for provenance='attestation'.
  attested_by_user_id   UUID        NULL REFERENCES users(id) ON DELETE SET NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT control_canonical_identities_provenance_check
    CHECK (provenance IN ('attestation', 'template', 'customer_mapped', 'inferred')),

  CONSTRAINT control_canonical_identities_confidence_check
    CHECK (confidence BETWEEN 0 AND 100),

  -- A human attestation must name the human. Machine evidence must not pretend
  -- to. Identical in shape and intent to
  -- asset_product_identities_attestation_actor_chk.
  CONSTRAINT control_canonical_identities_attestation_actor_check
    CHECK (
      (provenance =  'attestation' AND attested_by_user_id IS NOT NULL)
      OR
      (provenance <> 'attestation' AND attested_by_user_id IS NULL)
    )
);

-- One row per (control, canonical control, provenance): a template load and a
-- human attestation may BOTH claim the same identity, and a reader ranks them
-- rather than one silently clobbering the other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_control_canonical_identities_unique
  ON control_canonical_identities
     (organization_id, control_id, canonical_control_id, provenance);

-- "Which of this org's controls implement this canonical control?" — the hop
-- the assurance chain walks.
CREATE INDEX IF NOT EXISTS idx_control_canonical_identities_by_canonical
  ON control_canonical_identities (organization_id, canonical_control_id);

-- "What does this control implement?" — the control-detail path.
CREATE INDEX IF NOT EXISTS idx_control_canonical_identities_by_control
  ON control_canonical_identities (organization_id, control_id);

COMMENT ON TABLE control_canonical_identities IS
  'Tenant control -> global canonical control, with provenance. A control with '
  'NO row here is a customer-specific control with no canonical identity — a '
  'legitimate, representable state, NOT a gap to be filled. Mirrors '
  'asset_product_identities, including the CHECK that makes attestation '
  'structurally require a named human.';

COMMENT ON COLUMN control_canonical_identities.provenance IS
  '''attestation'' (a human declared it; requires attested_by_user_id), '
  '''template'' (an industry template instantiated it, resolved through '
  'canonical_control_aliases), ''customer_mapped'' (the customer mapped their '
  'own control), ''inferred'' (a weak match, recorded so weak stays visible as '
  'weak). Absence of a row means "no canonical identity", never "not looked at".';

-- Tenant data -> RLS.
ALTER TABLE control_canonical_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS control_canonical_identities_tenant_isolation ON control_canonical_identities;
CREATE POLICY control_canonical_identities_tenant_isolation
  ON control_canonical_identities
  FOR ALL
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON control_canonical_identities TO app_request;
