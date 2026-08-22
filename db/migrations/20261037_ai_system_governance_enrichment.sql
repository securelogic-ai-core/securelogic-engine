-- Migration: ai_system_governance_enrichment
-- Package:   AI Governance T2-C (inventory enrichment) + T2-D (material change,
--            reassessment) — capability-baseline F.1 remediation, first of three.
--
-- The baseline finding this answers, verbatim: "`ai_systems` is 8 mostly-free-
-- text columns" — an inventory that cannot say who is accountable for a system
-- on the business side, what regulatory tier it sits in, what kind of human
-- oversight constrains it, what sensitive data it touches, or when it must be
-- looked at again. Every column below is that sentence, made structural.
--
-- ── Everything here is ADDITIVE AND NULLABLE ────────────────────────────────
-- No CHECK is added to any EXISTING free-text column (model_type,
-- data_classification, deployment_status, risk_classification). Rows exist in
-- every environment, and constraining a populated free-text column either
-- fails the migration or silently rejects writes the product accepted
-- yesterday. The structured vocabulary lands in NEW columns; the legacy
-- columns keep their meaning and are deprecated in comments, not dropped.
-- `risk_classification` in particular is superseded by `eu_ai_act_tier` below
-- and should stop being written once the routes adopt the new column.
--
-- ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
-- NO model-provider column. The baseline lists "model provider" as missing,
-- but the RELATIONSHIP already exists, typed and FK-backed:
-- `ai_system_vendor_dependencies` with `dependency_role = 'model_provider'`.
-- A `provider_vendor_id` scalar here would be a second, parallel statement of
-- the same fact — the exact defect class the vendor<-finding linkage work just
-- spent a package removing. Readers that need the provider join the edge.
--
-- ── Vocabulary reuse (one vocabulary platform-wide) ─────────────────────────
-- `human_oversight_level` uses the IDENTICAL string set as
-- `vendor_engagements.ai_autonomy` ('none' / 'human_in_the_loop' /
-- 'human_on_the_loop' / 'autonomous_consequential'). The platform already
-- committed to that vocabulary for AI autonomy when assessing a VENDOR's AI;
-- describing the organisation's OWN systems with a different word list would
-- make the two surfaces unjoinable and force a crosswalk nobody maintains.
--
-- ── Reassessment mirrors the engagement monitoring shape ────────────────────
-- `review_cadence_days` / `next_review_due` are the same names, types and
-- semantics as `vendor_engagements`. Overdue is COMPUTED AT READ
-- (`next_review_due < CURRENT_DATE`), exactly as GET /api/vendor-engagements
-- computes `review_overdue` — no worker, no notification sweep in this
-- package. The engagement-style claim-then-emit sweep is a follow-up once
-- there is a consumer for the notification; a column nothing reads is not a
-- capability.
--
-- ── Material change is a COUNTER plus a RECOMMENDATION, not an event log ────
-- `material_state_version` increments when a PATCH changes a load-bearing
-- governance field (the route decides which fields are load-bearing and says
-- so). `reassessment_recommended_at` / `reassessment_reason` record the
-- deterministic, plain-language consequence — mirroring
-- `vendor_engagements.reassessment_reason`, and for the same reason: a
-- recommendation a reviewer cannot interrogate is one they will ignore.
-- The full audit trail of WHAT changed stays where it already lives —
-- security_audit_log via writeAuditEvent on the PATCH.
--
-- Additive only. No table created, no row written, no existing value touched.

-- ── ai_systems: accountability ──────────────────────────────────────────────
-- The pre-existing `owner_user_id` is, and remains, the TECHNICAL owner (the
-- person who can answer "how does it work / turn it off"). The business owner
-- answers "why does this exist and who accepts its risk" — a different person
-- in any organisation large enough to be buying this product, and the one an
-- AI-governance reviewer asks for first.
ALTER TABLE ai_systems
  ADD COLUMN IF NOT EXISTS business_owner_user_id UUID NULL
    REFERENCES users(id) ON DELETE SET NULL;

-- ── ai_systems: regulatory + oversight vocabulary ───────────────────────────
-- EU AI Act tier, as a closed vocabulary. 'not_applicable' is for systems
-- genuinely outside the Act's scope; NULL means "not yet classified", which is
-- a different (and reportable) fact.
ALTER TABLE ai_systems
  ADD COLUMN IF NOT EXISTS eu_ai_act_tier TEXT NULL;
ALTER TABLE ai_systems
  DROP CONSTRAINT IF EXISTS ai_systems_eu_ai_act_tier_check;
ALTER TABLE ai_systems
  ADD CONSTRAINT ai_systems_eu_ai_act_tier_check CHECK (
    eu_ai_act_tier IS NULL OR eu_ai_act_tier IN
      ('prohibited', 'high_risk', 'limited_risk', 'minimal_risk', 'not_applicable')
  );

ALTER TABLE ai_systems
  ADD COLUMN IF NOT EXISTS human_oversight_level TEXT NULL;
ALTER TABLE ai_systems
  DROP CONSTRAINT IF EXISTS ai_systems_human_oversight_level_check;
ALTER TABLE ai_systems
  ADD CONSTRAINT ai_systems_human_oversight_level_check CHECK (
    human_oversight_level IS NULL OR human_oversight_level IN
      ('none', 'human_in_the_loop', 'human_on_the_loop', 'autonomous_consequential')
  );

-- ── ai_systems: sensitive data ──────────────────────────────────────────────
-- A closed multi-select, not free text: the categories are what reports and
-- scope rules will filter on. Empty array = "declared: none". NULL = "never
-- declared" — again a different, reportable fact, which is why the column is
-- nullable rather than defaulted.
ALTER TABLE ai_systems
  ADD COLUMN IF NOT EXISTS sensitive_data_categories TEXT[] NULL;
ALTER TABLE ai_systems
  DROP CONSTRAINT IF EXISTS ai_systems_sensitive_data_categories_check;
ALTER TABLE ai_systems
  ADD CONSTRAINT ai_systems_sensitive_data_categories_check CHECK (
    sensitive_data_categories IS NULL OR sensitive_data_categories <@ ARRAY[
      'pii', 'phi', 'payment_card', 'credentials', 'biometric',
      'financial', 'proprietary'
    ]::text[]
  );

-- ── ai_systems: reassessment clock ──────────────────────────────────────────
ALTER TABLE ai_systems
  ADD COLUMN IF NOT EXISTS review_cadence_days INTEGER NULL;
ALTER TABLE ai_systems
  DROP CONSTRAINT IF EXISTS ai_systems_review_cadence_days_check;
ALTER TABLE ai_systems
  ADD CONSTRAINT ai_systems_review_cadence_days_check CHECK (
    review_cadence_days IS NULL OR review_cadence_days > 0
  );
ALTER TABLE ai_systems
  ADD COLUMN IF NOT EXISTS next_review_due DATE NULL;

-- ── ai_systems: material change ─────────────────────────────────────────────
ALTER TABLE ai_systems
  ADD COLUMN IF NOT EXISTS material_state_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ai_systems
  ADD COLUMN IF NOT EXISTS reassessment_recommended_at TIMESTAMPTZ NULL;
ALTER TABLE ai_systems
  ADD COLUMN IF NOT EXISTS reassessment_reason TEXT NULL;

COMMENT ON COLUMN ai_systems.material_state_version IS
  'Incremented by the PATCH route when a load-bearing governance field changes '
  '(the route names the set). A use-approval records the version it was decided '
  'against, so "approved, but the system has materially changed since" is a '
  'queryable fact rather than a reviewer''s recollection.';

-- The read path's filter: "what is due". Partial — most systems will have no
-- cadence configured, and they must cost nothing here.
CREATE INDEX IF NOT EXISTS idx_ai_systems_review_due
  ON ai_systems (organization_id, next_review_due)
  WHERE next_review_due IS NOT NULL;

-- ── ai_governance_assessments: reviewer identity defect ─────────────────────
-- The baseline records `reviewer_id TEXT, not a user FK` as a defect. The TEXT
-- column stays (rows hold free-text names that cannot be resolved to users
-- retroactively without inventing attributions); the FK lands beside it and
-- the routes write BOTH until the TEXT column is retired. New readers join the
-- FK; the TEXT value is display-only legacy.
ALTER TABLE ai_governance_assessments
  ADD COLUMN IF NOT EXISTS reviewer_user_id UUID NULL
    REFERENCES users(id) ON DELETE SET NULL;
