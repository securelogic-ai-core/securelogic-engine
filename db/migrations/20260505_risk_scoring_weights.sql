-- Migration: risk_scoring_weights
-- Package: obligation-aware-risk-scoring (Package 3 of 7)
--
-- Creates:
--   risk_scoring_weights — one row per organization holding three named
--                          weight maps that drive computeRiskScore. Customer-
--                          configurable; falls back to documented defaults
--                          when no row exists.
--
-- Modifies: nothing. Additive only.
--
-- Tenant rules (enforced at the application layer per
--               TENANT_ISOLATION_STANDARD.md §4):
--   - weights row's organization_id is sourced from req.organizationContext,
--     never from the request body.
--   - PUT is upsert keyed on organization_id (UNIQUE constraint below).
--
-- Two-vocabulary design (intentional, see CANONICAL_DOMAIN_MODEL.md):
--   - severity_weights uses PascalCase keys {Critical, High, Moderate, Low}
--     because cyber_signals.severity is stored that way (CHECK constraint
--     established in 20260430_cyber_signals_ingestion.sql).
--   - entity_criticality_weights uses lowercase keys {critical, high, medium,
--     low} because vendors.criticality and ai_systems.criticality are stored
--     that way (CHECK established in 20260412_vendor_risk_primitives.sql and
--     20260414_ai_system_governance_primitives.sql).
--   - obligation_priority_weights uses lowercase snake_case keys {immediate,
--     near_term, planned, watch} matching obligations.priority CHECK
--     constraint from 20260418_obligation_regulatory_primitives.sql.
--   The two enums are conceptually parallel but lexically distinct. Mixing
--   them is a real bug surface — keeping them as separate maps with their
--   stored vocabularies prevents accidental "Moderate"="medium" conflation.
--
-- Validation:
--   The application-layer validator (riskScoringWeightsValidation.ts)
--   enforces exact-key-set membership and value range (0, 1] on each of
--   the three maps. The DB stores JSONB without further constraint —
--   schema enforcement at the boundary, not via Postgres CHECK on JSONB
--   keys (CHECKs on JSONB structure are clumsy and version-fragile).

CREATE TABLE IF NOT EXISTS risk_scoring_weights (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Three named weight maps. Each is a JSONB object whose keys are the
  -- canonical vocabulary for its dimension and whose values are numbers
  -- in the open-on-zero / closed-on-one interval (0, 1].
  entity_criticality_weights  JSONB        NOT NULL,
  obligation_priority_weights JSONB        NOT NULL,
  severity_weights            JSONB        NOT NULL,

  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by_user_id          UUID         NULL REFERENCES users(id) ON DELETE SET NULL,

  -- One weights row per organization. PUT upserts on this key.
  UNIQUE (organization_id)
);

-- Org-scoped lookup is the only access pattern; the UNIQUE on
-- organization_id already provides an index. No additional indexes
-- are needed.
