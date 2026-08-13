-- Migration: requirement_scope_tags
--
-- The one piece of NEW reference data the deterministic questionnaire-scoping
-- model needs. Everything else the resolver consumes already ships.
--
-- ── Why this is load-bearing ────────────────────────────────────────────────
-- `resolveEngagementScope` includes a requirement when its tags match the rule
-- that fired. Tier 1 takes `*` — every requirement — but every lower tier takes
-- a tag list. With no tags, a tier-2/3/4 engagement produces an EMPTY
-- questionnaire, which is worse than an error: it looks like a working system
-- returning a fast clean result.
--
-- ── Why the backfill is marked heuristic ────────────────────────────────────
-- Tagging a requirement corpus is a curation task for someone who knows both the
-- framework and the assessment model. That has not happened. The backfill below
-- derives a starting set from each requirement's reference and title, and stamps
-- `scope_tags_source = 'heuristic'` so that:
--
--   * a human correction ('curated') is never overwritten by a re-run;
--   * a reviewer can tell whether a control was included because someone decided
--     it applied, or because its title contained the word "access";
--   * `SELECT count(*) FILTER (WHERE scope_tags_source = 'curated')` answers the
--     real pre-launch readiness question.
--
-- The SQL below MIRRORS `src/api/lib/vendorRisk/requirementScopeTags.ts`. Two
-- implementations of one rule set is a duplication with a cost, and it is taken
-- deliberately: the migration must run without an application boot, and the
-- module must tag requirements created after this migration. A test asserts the
-- two agree on a shared fixture, so drift fails CI rather than silently
-- producing two different questionnaires for the same corpus.
--
-- Idempotent and re-runnable: only rows still marked 'heuristic' are rewritten.

ALTER TABLE requirements
  ADD COLUMN IF NOT EXISTS scope_tags        TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scope_tags_source TEXT   NULL,
  ADD COLUMN IF NOT EXISTS scope_tags_at     TIMESTAMPTZ NULL;

ALTER TABLE requirements
  DROP CONSTRAINT IF EXISTS requirements_scope_tags_source_check;
ALTER TABLE requirements
  ADD CONSTRAINT requirements_scope_tags_source_check CHECK (
    scope_tags_source IS NULL OR scope_tags_source IN ('heuristic', 'curated')
  );

-- The resolver's hot path is "which requirements carry any of these tags".
CREATE INDEX IF NOT EXISTS idx_requirements_scope_tags
  ON requirements USING GIN (scope_tags);

COMMENT ON COLUMN requirements.scope_tags IS
  'Applicability vocabulary consumed by the vendor-assurance scope resolver. A '
  'requirement with no tags is invisible to every tier below 1 — not excluded by '
  'a rule, but absent with no reviewer-facing trace. The backfill therefore '
  'falls back to ''core'' rather than leaving a row untagged.';

COMMENT ON COLUMN requirements.scope_tags_source IS
  '''heuristic'' = derived from the title by the backfill. ''curated'' = a human '
  'stood behind it. Re-running the backfill never overwrites ''curated''.';

-- ---------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------

WITH derived AS (
  SELECT
    r.id,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN h ~* '(information security (policy|program|management)|security policy|risk (assessment|management)|security awareness|training|vulnerability (management|scanning)|patch(ing)?|incident|encrypt|access control|backup)'
           THEN 'core' END,

      CASE WHEN h ~* '(access control|authoriz|authentication|password|\mmfa\M|multi-?factor)'
           THEN 'access-control' END,
      CASE WHEN h ~* '(identity|account (management|provisioning)|joiner|leaver|provisioning)'
           THEN 'iam' END,
      CASE WHEN h ~* '(privileged|administrat|root access|superuser)'
           THEN 'privileged-access' END,
      CASE WHEN h ~* '(segregation of duties|separation of duties|\msod\M)'
           THEN 'segregation-of-duties' END,

      CASE WHEN h ~* '(data protection|data (handling|classification|security)|confidentialit)'
           THEN 'data-protection' END,
      CASE WHEN h ~* '(privacy|personal data|\mpii\M|\mphi\M|\mgdpr\M|data subject|consent)'
           THEN 'privacy' END,
      CASE WHEN h ~* '(retention|disposal|deletion|destruction|archiv)'
           THEN 'retention' END,
      CASE WHEN h ~* '(encrypt|cryptograph|key management|\mtls\M|at rest|in transit)'
           THEN 'encryption' END,
      CASE WHEN h ~* '(tenan|isolation|segregat(e|ion) of (customer|client) data|logical separation)'
           THEN 'tenancy-isolation' END,

      CASE WHEN h ~* '(logging|audit (log|trail)|monitoring|\msiem\M|event log)'
           THEN 'logging' END,
      CASE WHEN h ~* '(incident|breach|response plan|notification|escalation)'
           THEN 'incident-response' END,
      CASE WHEN h ~* '(resilien|availabilit|redundan|failover|capacity)'
           THEN 'resilience' END,
      CASE WHEN h ~* '(business continuity|\mbcp\M|disaster recovery|\mdr\M|backup|recovery)'
           THEN 'business-continuity' END,

      CASE WHEN h ~* '(supply chain|third[- ]party|vendor (management|risk)|supplier|outsourc)'
           THEN 'supply-chain' END,
      CASE WHEN h ~* '(sub-?processor|sub-?contractor|fourth[- ]party)'
           THEN 'subprocessor' END,

      CASE WHEN h ~* '(ai governance|artificial intelligence|machine learning|algorithm|automated decision)'
           THEN 'ai-governance' END,
      CASE WHEN h ~* '(model (risk|validation|monitoring|drift)|training data|bias)'
           THEN 'model-risk' END,
      CASE WHEN h ~* '(explainab|interpretab|transparen)'
           THEN 'explainability' END,
      CASE WHEN h ~* '(human (oversight|review|in the loop)|manual review)'
           THEN 'human-oversight' END
    ], NULL) AS tags
  FROM (
    SELECT id, reference_id || ' ' || title AS h
      FROM requirements
  ) AS r
)
UPDATE requirements req
   SET scope_tags = CASE
                      -- The fallback. An untagged requirement is invisible to
                      -- every tier below 1, and invisible is the one outcome
                      -- with no reviewer-facing trace.
                      WHEN cardinality(d.tags) = 0 THEN ARRAY['core']
                      ELSE (SELECT ARRAY(SELECT DISTINCT unnest(d.tags) ORDER BY 1))
                    END,
       scope_tags_source = 'heuristic',
       scope_tags_at     = NOW()
  FROM derived d
 WHERE req.id = d.id
   -- Never overwrite a human's decision.
   AND (req.scope_tags_source IS NULL OR req.scope_tags_source = 'heuristic');
