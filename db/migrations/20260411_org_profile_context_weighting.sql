-- Org Profile Context Weighting
--
-- Adds four organization profile columns that feed into posture computation.
-- Before this migration, posture snapshots used a hardcoded neutral context
-- (regulated=false, handlesPII=false, safetyCritical=false, scale='Small'),
-- which meant all context multipliers were 1.0 regardless of actual org profile.
--
-- After this migration, posture snapshot computation reads these columns and
-- passes real context values into DomainRiskAggregationEngineV2, allowing
-- scores to reflect the actual amplification appropriate for regulated,
-- PII-handling, safety-critical, or enterprise-scale organizations.
--
-- All columns are NOT NULL with safe defaults so existing rows are unaffected.
-- The scale CHECK constraint matches the engine's accepted values exactly.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS regulated       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handles_pii     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS safety_critical BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scale           TEXT    NOT NULL DEFAULT 'Small'
    CHECK (scale IN ('Small', 'Medium', 'Enterprise'));
