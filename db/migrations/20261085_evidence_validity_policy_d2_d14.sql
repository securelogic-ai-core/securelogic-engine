-- =====================================================================
-- 20261085 — Evidence-validity policy: owner rulings D2 through D14
-- =====================================================================
--
-- Authority: owner ratification 2026-09-02 of D2-D14, recorded in
-- docs/design/VA-EVIDENCE-validity-policy-RATIFICATION-MEMO.md. The
-- ratification carries AMENDMENTS to the recommendations that were put to the
-- owner, and the amendments are what this migration implements.
--
-- 20261083 built the machinery and seeded D1 only. Every other assurance class
-- has had no policy row since, which is why it established no validity. This
-- migration seeds the ratified classes and adds the mechanisms those rulings
-- require that the table could not previously express.
--
-- ---------------------------------------------------------------------------
-- D2, AND WHY THE SOC CEILING IS *NOT* LOWERED
-- ---------------------------------------------------------------------------
--
-- D2 ratified three things together: months 13-15 of a SOC report's life may
-- count ONLY when a governed bridge letter covers that period; the absolute
-- platform ceiling remains report period end + 15 months; and D1 must not
-- INDEPENDENTLY permit months 13-15 without that bridge condition.
--
-- The obvious implementation — drop max_duration_months from 15 to 12 — was
-- rejected. It encodes a DIFFERENT rule that merely coincides with the ratified
-- one while no bridge exists: it discards the ratified 15-month absolute
-- ceiling entirely, and it strands any organization that had already used its
-- D15 right to sit between 13 and 15 months, leaving a live setting that no
-- trigger will ever re-check against the lowered ceiling.
--
-- Instead the CONDITION itself is stored. `bridge_required_above_months` = 12
-- says: beyond month 12, a governed bridge letter must cover the gap. No
-- bridge-letter artifact or linkage model exists, so today nothing can satisfy
-- the condition and every SOC window is refused above 12 — the same behaviour
-- the ceiling drop would have produced, without discarding the ratified 15 and
-- without stranding anyone. When the bridge model lands, the bridge package
-- supplies the satisfied-condition check and 13-15 becomes reachable exactly as
-- D2 ratified, with no second policy version needed.
--
-- Bridge letters are MANAGEMENT REPRESENTATIONS. Their provenance must stay
-- distinguishable from independent audit evidence, which is a requirement on
-- the future bridge artifact, recorded here so it is not lost.
--
-- ---------------------------------------------------------------------------
-- THE ANCHOR VOCABULARY IS CORRECTED WHILE IT IS STILL FREE
-- ---------------------------------------------------------------------------
--
-- `artifact_term` is seeded by NOTHING today (20261083 seeds only
-- report_period_end and 'none'), so renaming it costs zero rows now and a data
-- migration later. It is renamed to `artifact_stated_date` because that is what
-- it actually means: the anchor is a date the ARTIFACT states. It never meant
-- "the artifact states its own end" — that role now belongs to
-- requires_artifact_end, which is a different question about a different date.
--
-- Five classes are seeded on it (ISO certification, pen test, BCP/DR test,
-- privacy agreement, sub-processor list). Under the old name two of them would
-- have had to ride `report_period_end`, which is SOC vocabulary and describes
-- no field a pen test or a DR exercise has.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT SEEDED
-- ---------------------------------------------------------------------------
--
--   contract (D13) and other_assurance_report (D14) get NO ROW, by explicit
--   ruling. Their currency comes from a human committing the artifact's own
--   dates. A row for either would be the catch-all TTL both rulings forbid.
--   Absence of a row is what PERMITS the artifact basis for them.
--
--   ai_evaluation (D12) gets a row with NO DURATION. It grants nothing. It
--   records that D12 IS ratified and that the ratified outcome is no automated
--   assurance coverage until canonical model-version identity exists, and it
--   carries `no_window_reason` so the platform says WHY rather than emitting a
--   generic slug that would read as "nobody decided".
--
-- ROLLBACK: db/rollback/20261085_evidence_validity_d2_d14_rollback.sql
--
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------
-- 1. Anchor vocabulary: rename artifact_term, add object_cadence
-- ---------------------------------------------------------------

-- 20261083 declared the anchor CHECK inline, so its generated name is not
-- stable across environments. Find it by definition and drop it by name.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'evidence_validity_policy'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) LIKE '%report_period_end%'
       AND pg_get_constraintdef(con.oid) LIKE '%artifact_term%'
  LOOP
    EXECUTE format('ALTER TABLE evidence_validity_policy DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- Free because nothing uses it. Asserted, not assumed: if any row carries the
-- old value this migration ABORTS rather than silently rewriting policy.
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM evidence_validity_policy WHERE anchor = 'artifact_term';
  IF n > 0 THEN
    RAISE EXCEPTION
      'refusing to rename anchor: % policy row(s) already use artifact_term. Rewriting a ratified anchor under live rows needs its own decision.', n;
  END IF;
END $$;

ALTER TABLE evidence_validity_policy
  ADD CONSTRAINT evidence_validity_policy_anchor_check CHECK (
    anchor IN ('report_period_end', 'collected_at', 'artifact_stated_date', 'object_cadence', 'none')
  );

COMMENT ON COLUMN evidence_validity_policy.anchor IS
  'What the window is measured FROM. report_period_end = a coverage period the '
  'artifact states (SOC). artifact_stated_date = any other date the artifact '
  'itself states — certificate issue, test end, exercise end, agreement '
  'effective date, list as-of date. collected_at = the observation date on the '
  'evidence row, never the upload date. object_cadence = follow a LINKED '
  'governed object''s own review cadence (D7 policy_document -> policies, D10 '
  'vendor_attestation -> vendor_engagements); unlinked evidence establishes '
  'nothing. ''none'' = this class establishes no policy-derived window at all.';

-- ---------------------------------------------------------------
-- 2. requires_artifact_end (D3)
-- ---------------------------------------------------------------

ALTER TABLE evidence_validity_policy
  ADD COLUMN IF NOT EXISTS requires_artifact_end BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN evidence_validity_policy.requires_artifact_end IS
  'D3: when TRUE the artifact''s own stated end is MANDATORY, not merely a cap. '
  'A row of this class with no asserted end resolves to not_established '
  '(artifact_end_required) instead of taking the policy window. Set for '
  'iso_certification, where the certifying body''s stated expiry is an absolute '
  'ceiling. Note this is the ONLY guard on the widest remaining trust surface: '
  'for artifact_stated_date classes both the anchor and the asserted end are '
  'read off the document by a human curator, because there is nowhere else '
  'those dates could come from.';

-- ---------------------------------------------------------------
-- 3. artifact_basis_permitted (D11, D13, D14)
-- ---------------------------------------------------------------

ALTER TABLE evidence_validity_policy
  ADD COLUMN IF NOT EXISTS artifact_basis_permitted BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN evidence_validity_policy.artifact_basis_permitted IS
  'May a curator commit the ARTIFACT''s own dates (validity_basis '
  '''artifact_dates'' or ''perpetual'') INSTEAD of a computed policy window? A '
  'class with NO policy row permits it by absence — that is the only mechanism '
  'contract (D13) and other_assurance_report (D14) have. For a class that DOES '
  'carry a ratified duration this defaults FALSE, because letting a curator '
  'commit artifact dates directly would route around the ratified window: '
  'global principle 4 says customer configuration may tighten freely but may '
  'never defeat a platform epistemic ceiling, and D11 says contractual validity '
  'and assurance currency must not be conflated. Flipping one row to TRUE is '
  'the whole mechanism if the owner rules otherwise for a given class.';

-- ---------------------------------------------------------------
-- 4. bridge_required_above_months (D2) and no_window_reason (D12)
-- ---------------------------------------------------------------

ALTER TABLE evidence_validity_policy
  ADD COLUMN IF NOT EXISTS bridge_required_above_months INTEGER NULL;

COMMENT ON COLUMN evidence_validity_policy.bridge_required_above_months IS
  'D2: beyond this many months from the anchor, the window counts ONLY when a '
  'governed bridge letter covers the gap. NULL = no bridge condition. Set to 12 '
  'for soc1 and soc2_type2 while max stays 15, which is D2 exactly: the '
  '15-month absolute ceiling is preserved and months 13-15 are conditional '
  'rather than removed. No bridge-letter artifact exists yet, so the condition '
  'is unsatisfiable and every SOC window is refused above month 12 today.';

ALTER TABLE evidence_validity_policy
  ADD COLUMN IF NOT EXISTS no_window_reason TEXT NULL;

COMMENT ON COLUMN evidence_validity_policy.no_window_reason IS
  'For a ratified class that establishes NO window, the machine-stable reason '
  'WHY. Without it the platform emits a generic slug that reads as "nobody '
  'decided", when in fact somebody decided precisely this. soc2_type1: a Type I '
  'attests design at a point in time. ai_evaluation: model-version identity is '
  'the prerequisite and SecureLogic does not have it yet.';

-- ---------------------------------------------------------------
-- 5. D2 — supersede the SOC rows to record the amendment
-- ---------------------------------------------------------------
--
-- Append-and-supersede, never edit: the version chain is what lets a
-- determination made under version 1 stay replayable against version 1.

UPDATE evidence_validity_policy
   SET superseded_at = NOW()
 WHERE assurance_class IN ('soc1', 'soc2_type2', 'soc2_type1')
   AND version = 1
   AND superseded_at IS NULL;

INSERT INTO evidence_validity_policy
  (assurance_class, version, default_duration_months, max_duration_months,
   min_duration_months, anchor, requires_artifact_end, artifact_basis_permitted,
   bridge_required_above_months, no_window_reason, ratification_ref, ratified_on, notes)
VALUES
  ('soc2_type2', 2, 12, 15, 3, 'report_period_end', FALSE, FALSE, 12, NULL,
   'D1+D2', DATE '2026-09-02',
   'D2 amendment to D1. Twelve months from the end of the period the report '
   'covers, and the 15-month absolute platform ceiling is PRESERVED. What '
   'changes is that months 13-15 are now CONDITIONAL: they count only when a '
   'governed bridge letter covers the gap. No bridge-letter artifact exists, so '
   'nothing can satisfy the condition today and a report without a qualifying '
   'bridge is stale after month 12 — which is exactly what D2 ratified. Bridge '
   'letters are management representations; their provenance must remain '
   'distinguishable from independent audit evidence.'),

  ('soc1', 2, 12, 15, 3, 'report_period_end', FALSE, FALSE, 12, NULL,
   'D1+D2', DATE '2026-09-02',
   'Same D2 amendment as soc2_type2, which D1 ratified together with SOC 1.'),

  ('soc2_type1', 2, NULL, NULL, NULL, 'none', FALSE, FALSE, NULL,
   'type_i_attests_design_only', 'D1', DATE '2026-09-02',
   'Unchanged in substance from version 1: a Type I establishes NO '
   'operating-effectiveness window. Superseded only to carry no_window_reason, '
   'so the platform states the reason rather than emitting a generic slug. D1 '
   'ratified that a Type I must not inherit the Type II rule and named no '
   'number; this migration still does not invent one.')
ON CONFLICT (assurance_class, version) DO NOTHING;

-- ---------------------------------------------------------------
-- 6. D3-D12 — the newly ratified classes
-- ---------------------------------------------------------------

INSERT INTO evidence_validity_policy
  (assurance_class, version, default_duration_months, max_duration_months,
   min_duration_months, anchor, requires_artifact_end, artifact_basis_permitted,
   bridge_required_above_months, no_window_reason, ratification_ref, ratified_on, notes)
VALUES
  -- D3 + D4 are one row. D3 governs the certificate's own dates; D4 governs the
  -- re-evidence cadence inside them. Whichever ends EARLIER binds, because the
  -- artifact end is an absolute ceiling and the cadence can only expire sooner.
  ('iso_certification', 1, 12, 36, 3, 'artifact_stated_date', TRUE, FALSE, NULL, NULL,
   'D3+D4', DATE '2026-09-02',
   'D3: the certificate''s stated expiry is an ABSOLUTE ceiling and is REQUIRED '
   '(requires_artifact_end) — a certificate whose expiry nobody recorded fails '
   'closed rather than inheriting a duration. D4: the assurance re-evidence '
   'cadence defaults to 12 months from the certificate''s stated date (issue, or '
   'the most recent governed re-evidence), min 3, max 36, and never beyond the '
   'certificate''s actual expiration. ISO/IEC 17021 mandates annual surveillance '
   'and the platform cannot observe it, so annual re-evidence is the observable '
   'proxy. A customer permitting reliance through more of the valid certificate '
   'term is ASSURANCE-POLICY CONFIGURATION, bounded by 36 and by the '
   'certificate itself. Risk acceptance is a different act in a different '
   'place: it never makes stale evidence current and never rewrites assurance '
   'truth.'),

  -- D5
  ('pen_test', 1, 12, 15, 3, 'artifact_stated_date', FALSE, FALSE, NULL, NULL,
   'D5', DATE '2026-09-02',
   'Twelve months from the ACTUAL TEST END DATE, min 3, max 15. Annual testing '
   'is PCI DSS 11.4 mandated in PCI scope and the common contractual '
   'expectation elsewhere; 15 is one cycle plus a quarter, the same shape as '
   'D1. Expired evidence stops contributing to CURRENT assurance while the '
   'engagement and its findings remain as history. next_test_due on the '
   'engagement and this window answer different questions and must not '
   'contradict each other: one schedules the next test, this one decides '
   'whether the last one still counts. A pen test is evidence about the '
   'environment AS TESTED — material environment change should invalidate it '
   'before this clock runs out, which is a known event-driven reassessment '
   'requirement the model has no signal for and which this package does not '
   'build.'),

  -- D6
  ('vulnerability_scan', 1, 3, 3, 1, 'collected_at', FALSE, FALSE, NULL, NULL,
   'D6', DATE '2026-09-02',
   'Three CALENDAR MONTHS from scan completion, min 1, max 3. The engine '
   'computes in whole calendar months, so this is three calendar months and is '
   'deliberately NOT described as an exact 90-day rule. Quarterly scanning is '
   'PCI DSS 11.3 mandated in PCI scope. A scan describes a moment and its '
   'assurance value decays with every deployment. The single ratified branch '
   'replaces the proposal''s 30-day continuous-scanning variant: whether '
   'continuous scanning is genuinely in place is not observable here, and a '
   'continuously-scanning organization can tighten to 1 month without a second '
   'rule.'),

  -- D7
  ('policy_document', 1, 24, 24, 1, 'object_cadence', FALSE, FALSE, NULL, NULL,
   'D7', DATE '2026-09-02',
   'Follows the LINKED governed policy object''s own review cadence — '
   'policies.last_reviewed_at as the anchor and policies.next_review_at as the '
   'cadence end — under an absolute ceiling of last review + 24 months. The '
   'duration here IS that ceiling and never a fallback window: an object_cadence '
   'class with no linked object fails closed, so 24 can never behave as a '
   'catch-all TTL. Whichever of the linked object''s next review and the ceiling '
   'comes first binds. No competing policy-document cadence is created; '
   'policies.review_frequency + last_reviewed_at -> next_review_at already '
   'answers this question and must keep answering it alone.'),

  -- D8
  ('bcp_dr_test', 1, 12, 18, 3, 'artifact_stated_date', FALSE, FALSE, NULL, NULL,
   'D8', DATE '2026-09-02',
   'Twelve months from the exercise end date, min 3, max 18. Annual exercise is '
   'the common expectation and DORA requires at least annual testing for EU '
   'financial entities. The ceiling is 18 rather than 24 because a two-year-old '
   'DR test describes an architecture that has almost always moved.'),

  -- D9
  ('technical_configuration', 1, 3, 6, 1, 'collected_at', FALSE, FALSE, NULL, NULL,
   'D9', DATE '2026-09-02',
   'Three months from the OBSERVATION date, min 1, max 6. The authoritative '
   'anchor is evidence.collected_at and uploaded_at may NEVER substitute for '
   'it: an export taken in March and uploaded in July is four months old, not '
   'new. collected_at is REQUIRED for this class and its absence is '
   'not_established, never a fallback. The writer binds this anchor from '
   'governed evidence state, so a caller cannot manufacture freshness by '
   'supplying a date.'),

  -- D10
  ('vendor_attestation', 1, 24, 24, 1, 'object_cadence', FALSE, FALSE, NULL, NULL,
   'D10', DATE '2026-09-02',
   'Follows the governed engagement reassessment cadence — the collecting '
   'vendor_engagements row''s decided_at as the anchor and its next_review_due '
   'as the cadence end — under an ABSOLUTE 24-month SecureLogic assurance '
   'ceiling. The duration IS that ceiling, never a fallback: an attestation not '
   'linked to an engagement fails closed. The shorter of cadence and ceiling '
   'always wins, so a customer engagement cadence of 36, 60 or 120 months can '
   'never keep an attestation older than 24 months current as assurance. '
   'Business reassessment SCHEDULING and evidence assurance CURRENCY are '
   'deliberately different questions: the engagement may schedule whatever it '
   'likes and this ceiling still binds.'),

  -- D11, first half
  ('privacy_agreement', 1, 24, 36, 6, 'artifact_stated_date', FALSE, FALSE, NULL, NULL,
   'D11', DATE '2026-09-02',
   'Twenty-four months of ASSURANCE CURRENCY from the agreement effective date, '
   'min 6, max 36. An explicit contractual termination or expiration is always '
   'an absolute ceiling. A DPA may remain legally and contractually in force '
   'long after its assurance evidence goes stale, and D11 ruled those two '
   'questions must not be conflated — this row governs only the second. '
   'artifact_basis_permitted is FALSE for exactly that reason: committing '
   '''perpetual'' here would assert unlimited ASSURANCE currency on the strength '
   'of a CONTRACTUAL fact, which is the conflation D11 forbids and which global '
   'principle 4 forbids independently. Evergreen status is never inferred from a '
   'missing end date under any reading. SEE THE RATIFICATION MEMO: this is the '
   'one interpretive call in the package and it is one row value to flip.'),

  -- D11, second half
  ('subprocessor_list', 1, 12, 12, 3, 'artifact_stated_date', FALSE, FALSE, NULL, NULL,
   'D11', DATE '2026-09-02',
   'Twelve months from the authoritative as-of / publication date, min 3, max '
   '12. Held separate from privacy_agreement on purpose: a current DPA does not '
   'make a stale sub-processor list current, and a fresh list does not revive a '
   'terminated agreement. A DPA valid for years routinely carries an annex a '
   'year out of date, and one duration for both would have made the '
   'shorter-lived half invisible.'),

  -- D12 — ratified, and ratified to establish NOTHING automatically.
  ('ai_evaluation', 1, NULL, NULL, NULL, 'none', FALSE, FALSE, NULL,
   'model_version_identity_required', 'D12', DATE '2026-09-02',
   'NO policy-derived validity, and this row exists to say so precisely. Model '
   'identity / version is the semantic prerequisite for deciding whether an '
   'evaluation describes the CURRENT model, and SecureLogic has no canonical '
   'model-version identity to bind an evaluation to. Until it does, unbound AI '
   'evaluation evidence is not_established for automated assurance coverage: a '
   'time-based fallback would assert something the platform cannot know. '
   'SECURELOGIC CANNOT CURRENTLY DETERMINE WHETHER AN EVALUATION DESCRIBES THE '
   'PRESENTLY DEPLOYED MODEL, and that limitation must never be represented as '
   'current assurance. The evidence is still retained, reviewable and usable in '
   'human workflows. When canonical model-version identity exists, a SECONDARY '
   'time policy of 6 default / 1 min / 12 max anchored on evaluation completion '
   'arrives as version 2, and a model-version change invalidates prior '
   'model-specific evaluation immediately, overriding any remaining time '
   'window. Building that identity is the AI-system inventory package, tracked '
   'and deliberately not built here.')
ON CONFLICT (assurance_class, version) DO NOTHING;

-- ---------------------------------------------------------------
-- 7. Shape constraints for the new columns
-- ---------------------------------------------------------------
--
-- Added AFTER the seeds, deliberately. A constraint that a ratified row cannot
-- satisfy is a constraint that is wrong about the policy, and adding it first
-- would have failed the migration on 20261083's own soc2_type1 row.
--
-- SUPERSEDED ROWS ARE EXEMPT. History is append-only: a version ratified under
-- an earlier shape stays exactly as it was ratified, or the version chain stops
-- being a record of what was in force and becomes a record of today's schema.
-- Only LIVE policy must satisfy today's shape.

ALTER TABLE evidence_validity_policy
  DROP CONSTRAINT IF EXISTS evidence_validity_policy_new_columns_shape_check;
ALTER TABLE evidence_validity_policy
  ADD CONSTRAINT evidence_validity_policy_new_columns_shape_check CHECK (
    superseded_at IS NOT NULL
    OR
    -- A class that establishes no window cannot require an artifact end, cannot
    -- carry a bridge condition, and MUST say why it establishes nothing.
    (default_duration_months IS NULL
       AND requires_artifact_end = FALSE
       AND bridge_required_above_months IS NULL
       AND no_window_reason IS NOT NULL)
    OR
    (default_duration_months IS NOT NULL
       AND no_window_reason IS NULL
       AND (bridge_required_above_months IS NULL
            OR (bridge_required_above_months >= 1
                AND bridge_required_above_months <= max_duration_months)))
  );

-- For an object_cadence class the duration IS the absolute ceiling, never a
-- fallback window: the linked object supplies the cadence and missing linkage
-- fails closed. Pinning default = max makes that impossible to misread as a
-- catch-all TTL, which D7 and D10 both forbid.
ALTER TABLE evidence_validity_policy
  DROP CONSTRAINT IF EXISTS evidence_validity_policy_object_cadence_ceiling_check;
ALTER TABLE evidence_validity_policy
  ADD CONSTRAINT evidence_validity_policy_object_cadence_ceiling_check CHECK (
    anchor <> 'object_cadence' OR default_duration_months = max_duration_months
  );

-- ---------------------------------------------------------------
-- 8. D13 / D14 — deliberately NO rows
-- ---------------------------------------------------------------
--
-- contract (D13) and other_assurance_report (D14) are seeded with nothing, by
-- explicit ruling. Their currency comes from a human committing what the
-- artifact itself states — validity_basis 'artifact_dates' with the stated end,
-- or 'perpetual' as an explicit governed assertion that the artifact asserts no
-- end. The ABSENCE of a policy row is what permits that basis. A missing end
-- date NEVER implies perpetual. Early termination of a contract is a governed
-- withdrawal event, and the known limitation that an unrecorded early
-- termination leaves evidence appearing current is tracked rather than papered
-- over with a TTL. Contract LEGAL validity and contract ASSURANCE use remain
-- semantically distinguishable.
--
-- PCI AOC (12 months) and HITRUST r2 (24 months with interim) have body-known
-- validity semantics and are candidates for their own named assurance classes
-- later. Their rules must NOT be encoded as defaults for the residual class.

COMMIT;
