-- ============================================================
-- Risk numeric score (Risk Workspace foundation, PR1)
-- 2026-07-06 (sequence-dated after 20260705 per migration convention)
--
-- Adds a deterministic 0–100 magnitude to each risk, derived from its
-- register axes (likelihood × impact). This is the ranking key for the Risk
-- Workspace, heatmap, and executive ordering. Distinct from signal scoring.
--
-- Methodology (ratified Option A): score = round(lw × iw × 100)
--   likelihood: very_likely 1.0, likely 0.8, possible 0.6, unlikely 0.4, rare 0.2
--   impact:     Critical 1.0,    High 0.75,  Moderate 0.5,  Low 0.25
--   bands:      Critical ≥75, High ≥50, Moderate ≥25, Low <25
--
-- All columns nullable; backfill is computed from existing ratings. A risk
-- with an incomplete axis pair carries a NULL score until both axes exist.
-- Additive + idempotent (IF NOT EXISTS); safe to re-run.
-- ============================================================

ALTER TABLE risks
  ADD COLUMN IF NOT EXISTS residual_score INTEGER,
  ADD COLUMN IF NOT EXISTS inherent_score INTEGER,
  ADD COLUMN IF NOT EXISTS score_basis    JSONB;

-- Range guards: a present score must be 0–100. NULL allowed (no score yet).
ALTER TABLE risks
  DROP CONSTRAINT IF EXISTS risks_residual_score_range;
ALTER TABLE risks
  ADD CONSTRAINT risks_residual_score_range
  CHECK (residual_score IS NULL OR (residual_score BETWEEN 0 AND 100));

ALTER TABLE risks
  DROP CONSTRAINT IF EXISTS risks_inherent_score_range;
ALTER TABLE risks
  ADD CONSTRAINT risks_inherent_score_range
  CHECK (inherent_score IS NULL OR (inherent_score BETWEEN 0 AND 100));

-- ------------------------------------------------------------
-- Backfill from existing residual/inherent likelihood × impact.
-- Weight maps are inlined as CASE expressions to match riskScore.ts.
-- Only rows where BOTH axes are present get a score.
-- ------------------------------------------------------------

UPDATE risks
SET residual_score = ROUND(
      (CASE residual_likelihood
         WHEN 'very_likely' THEN 1.0 WHEN 'likely' THEN 0.8
         WHEN 'possible' THEN 0.6 WHEN 'unlikely' THEN 0.4
         WHEN 'rare' THEN 0.2 END)
    * (CASE residual_impact
         WHEN 'Critical' THEN 1.0 WHEN 'High' THEN 0.75
         WHEN 'Moderate' THEN 0.5 WHEN 'Low' THEN 0.25 END)
    * 100
    ),
    score_basis = jsonb_build_object(
      'likelihood_weight', (CASE residual_likelihood
         WHEN 'very_likely' THEN 1.0 WHEN 'likely' THEN 0.8
         WHEN 'possible' THEN 0.6 WHEN 'unlikely' THEN 0.4
         WHEN 'rare' THEN 0.2 END),
      'impact_weight', (CASE residual_impact
         WHEN 'Critical' THEN 1.0 WHEN 'High' THEN 0.75
         WHEN 'Moderate' THEN 0.5 WHEN 'Low' THEN 0.25 END)
    )
-- IN-list guards (not merely IS NOT NULL) so an off-vocabulary legacy axis is
-- skipped entirely — leaving residual_score AND score_basis NULL, exactly as
-- computeRiskScore() returns null in riskScore.ts. Without this, a CASE→NULL
-- row would still write a junk score_basis of {null,null}.
WHERE residual_likelihood IN ('very_likely','likely','possible','unlikely','rare')
  AND residual_impact     IN ('Critical','High','Moderate','Low')
  AND residual_score IS NULL;

UPDATE risks
SET inherent_score = ROUND(
      (CASE inherent_likelihood
         WHEN 'very_likely' THEN 1.0 WHEN 'likely' THEN 0.8
         WHEN 'possible' THEN 0.6 WHEN 'unlikely' THEN 0.4
         WHEN 'rare' THEN 0.2 END)
    * (CASE inherent_impact
         WHEN 'Critical' THEN 1.0 WHEN 'High' THEN 0.75
         WHEN 'Moderate' THEN 0.5 WHEN 'Low' THEN 0.25 END)
    * 100
    )
WHERE inherent_likelihood IN ('very_likely','likely','possible','unlikely','rare')
  AND inherent_impact     IN ('Critical','High','Moderate','Low')
  AND inherent_score IS NULL;

-- Sort/rank support: highest residual score first, unscored rows last.
CREATE INDEX IF NOT EXISTS idx_risks_org_residual_score
  ON risks (organization_id, residual_score DESC NULLS LAST);
