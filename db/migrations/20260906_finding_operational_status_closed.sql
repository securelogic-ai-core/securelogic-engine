-- ============================================================
-- 20260906_finding_operational_status_closed.sql
-- Finding lifecycle — the operational axis acquires a TERMINAL state.
--
-- Authority: product ruling 2026-07-12; docs/specs/finding-lifecycle-spec.md
-- §1.1 (amended in the same program — the `closed` row and the compat bridge).
--
-- WHY THIS EXISTS. The canonical enterprise metric is now
--
--     Active Finding = operational_status <> 'closed'
--
-- but operational_status had NO terminal state: its CHECK was
-- IN ('open','in_progress','remediated') (20260901). Taken literally against
-- that schema, `operational_status <> 'closed'` is ALWAYS TRUE — it would have
-- counted every closed finding as Active, on every surface, silently. Closure
-- lived only on the legacy `status` axis. This migration is the prerequisite
-- that makes the canonical predicate mean what it says.
--
-- THE DERIVATION, AMENDED. operational_status stays SYSTEM-DERIVED and is still
-- never hand-set (spec §7). It is now a function of three inputs, in priority
-- order:
--
--   1. governance   decision_state = 'resolved'            -> 'closed'
--   2. compat       legacy status IN ('closed','accepted') -> 'closed'
--   3. workflow     the linked Actions (unchanged)         -> in_progress
--                                                             | remediated
--                                                             | open
--
-- Rule 2 is the COMPAT BRIDGE and it is the load-bearing part of this package.
-- Legacy `status` remains directly writable (PATCH /api/findings/:id, flag-off
-- behaviour, importers), and it is the only closure signal those writers have.
-- Deriving `closed` from it too means a legacy write can never leave the two
-- axes contradicting one another — a finding cannot be `status='closed'` while
-- `operational_status='open'`, which is exactly the state that would make the
-- new Active predicate disagree with every existing reader. The bridge retires
-- when `status` does.
--
-- POPULATION IS PRESERVED, EXACTLY. After the backfill below,
--
--     operational_status <> 'closed'   ==   status IN ('open','in_progress')
--
-- holds for EVERY row — the old canonical predicate and the new one select the
-- identical set. No customer-facing number moves in this package. That is
-- deliberate: the vocabulary convergence (which surfaces change from
-- strictly-open to Active) is a separate, ruled decision.
--
-- NOTE ON 'accepted'. Legacy status 'accepted' is a legal value
-- (VALID_PATCH_STATUSES) that no system path writes, and today's canonical
-- predicate `status IN ('open','in_progress')` EXCLUDES it — an accepted
-- finding is currently not Active. The backfill therefore maps it to 'closed',
-- preserving that. Note this is in tension with the two-axis model, where the
-- governance equivalent (`decision_state='accepted_risk'`) explicitly does NOT
-- close a finding — an accepted-risk finding is still carried, exactly as the
-- Risk register carries accepted risks. Reconciling those two is a POPULATION
-- change and needs a product ruling; it is deliberately NOT made here.
--
-- 'remediated' IS NOT CLOSED. Remediation completed, awaiting validation /
-- governance closure. It remains Active. Unchanged by this migration.
--
-- Additive; idempotent; safe to re-run. Rollback:
--   UPDATE findings SET operational_status = 'remediated'
--    WHERE operational_status = 'closed';   -- or 'open'; see note below
--   ALTER TABLE findings DROP CONSTRAINT findings_operational_status_check;
--   ALTER TABLE findings ADD CONSTRAINT findings_operational_status_check
--     CHECK (operational_status IN ('open','in_progress','remediated'));
-- Rollback is lossy ONLY in that the pre-migration operational_status of a
-- closed finding is not recoverable from operational_status alone — but it IS
-- recoverable, deterministically, by re-running the backfill's own derivation
-- against `status`/`decision_state`/actions, which this migration never mutates.
-- Legacy `status` and `decision_state` are NOT touched. No data is destroyed.
-- ============================================================

-- ── 1. Widen the operational axis to admit the terminal state ───────────────

ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_operational_status_check;

ALTER TABLE findings
  ADD CONSTRAINT findings_operational_status_check
  CHECK (operational_status IN ('open', 'in_progress', 'remediated', 'closed'));

-- ── 1b. The audit stream must be able to RECORD a closure ───────────────────
--
-- finding_lifecycle_events carries its own value CHECKs (20260901). They predate
-- the terminal state, so an operational→closed event was rejected outright — the
-- WORM history physically could not describe the transition the ruling requires.
-- Widened here, additively; no existing event row changes, and the append-only
-- triggers are untouched, so the audit history remains immutable and intact.

ALTER TABLE finding_lifecycle_events
  DROP CONSTRAINT IF EXISTS finding_lifecycle_event_states_check;

ALTER TABLE finding_lifecycle_events
  ADD CONSTRAINT finding_lifecycle_event_states_check CHECK (
    (axis = 'operational' AND to_state IN ('open', 'in_progress', 'remediated', 'closed'))
    OR
    (axis = 'decision' AND to_state IN ('needs_review', 'mitigating', 'accepted_risk', 'resolved'))
  );

ALTER TABLE finding_lifecycle_events
  DROP CONSTRAINT IF EXISTS finding_lifecycle_event_transition_check;

ALTER TABLE finding_lifecycle_events
  ADD CONSTRAINT finding_lifecycle_event_transition_check CHECK (
    transition IN (
      'operational_advanced', 'operational_remediated', 'operational_recomputed',
      -- new: crossing the closure boundary, in both directions. Named so the
      -- history shows a reopen AS a reopen rather than a generic recompute.
      'operational_closed', 'operational_reopened',
      'accept_plan', 'accept_risk', 'close', 'reopen'
    )
  );

-- ── 2. Deterministic backfill ───────────────────────────────────────────────
--
-- Every existing row is re-derived from canonical lifecycle evidence, in the
-- same priority order the writer (findingLifecycle.ts) now uses. This is a pure
-- function of data already in the table — no guessing, no NOW(), no ordering
-- dependence, so it is idempotent and produces the same result on a re-run.

WITH action_rollup AS (
  SELECT
    a.source_id AS finding_id,
    COUNT(*)                                                            AS n,
    COUNT(*) FILTER (WHERE a.status IN ('in_progress', 'blocked'))      AS n_active,
    COUNT(*) FILTER (WHERE a.status IN ('closed', 'accepted'))          AS n_terminal
  FROM actions a
  WHERE a.source_type = 'finding' AND a.source_id IS NOT NULL
  GROUP BY a.source_id
),
gate AS (
  SELECT
    f.id AS finding_id,
    COALESCE(
      (SELECT s.require_evidence_gate FROM risk_settings s
        WHERE s.organization_id = f.organization_id),
      FALSE
    ) AS enforced,
    EXISTS (
      SELECT 1 FROM evidence e
       WHERE e.organization_id = f.organization_id
         AND e.source_type = 'finding' AND e.source_id = f.id
    ) AS has_evidence
  FROM findings f
),
derived AS (
  SELECT
    f.id,
    CASE
      -- 1. governance closure, and 2. the legacy compat bridge
      WHEN f.decision_state = 'resolved'            THEN 'closed'
      WHEN f.status IN ('closed', 'accepted')       THEN 'closed'
      -- 3. workflow evidence — identical to deriveOperationalStatus()
      WHEN COALESCE(r.n_active, 0) > 0              THEN 'in_progress'
      WHEN COALESCE(r.n, 0) > 0
       AND COALESCE(r.n_terminal, 0) = COALESCE(r.n, 0)
       AND NOT (g.enforced AND NOT g.has_evidence)  THEN 'remediated'
      WHEN COALESCE(r.n, 0) > 0
       AND COALESCE(r.n_terminal, 0) = COALESCE(r.n, 0)
       AND g.enforced AND NOT g.has_evidence        THEN 'in_progress'
      ELSE 'open'
    END AS operational_status
  FROM findings f
  LEFT JOIN action_rollup r ON r.finding_id = f.id
  JOIN gate g               ON g.finding_id = f.id
)
UPDATE findings f
   SET operational_status = d.operational_status,
       updated_at         = f.updated_at   -- deliberately NOT bumped: a backfill
                                           -- is not a business event, and bumping
                                           -- updated_at would corrupt every
                                           -- "recently changed" view at once.
  FROM derived d
 WHERE d.id = f.id
   AND f.operational_status IS DISTINCT FROM d.operational_status;

-- ── 3. The non-contradiction invariant, enforced by the database ────────────
--
-- The whole point of the compat bridge is that the two axes cannot disagree
-- about CLOSURE while both are live. A CHECK is the only place that promise
-- survives a writer nobody remembered to update — an importer, a backfill
-- script, a future route. It is the schema-level statement of the Metric
-- Contract: there is one closure, and both axes report it identically.
--
-- Deliberately narrow: it constrains ONLY the closed/not-closed agreement. It
-- says nothing about open-vs-in_progress-vs-remediated, because legacy `status`
-- genuinely cannot represent `remediated` (spec §3 projects it to 'in_progress')
-- and pretending otherwise would make the constraint unsatisfiable.

ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_closure_axes_agree;

ALTER TABLE findings
  ADD CONSTRAINT findings_closure_axes_agree
  CHECK (
    (operational_status = 'closed') = (status IN ('closed', 'accepted'))
  );

-- ── 4. The compat bridge, at INSERT time ────────────────────────────────────
--
-- Every existing creator of a finding writes legacy `status` and knows nothing
-- about `operational_status` (it defaults to 'open'). A creator that inserts an
-- already-closed finding — an importer, a backfill, a reconciler — would
-- therefore write status='closed' alongside the default operational 'open' and be
-- rejected by the invariant above.
--
-- Rejecting them is the wrong answer: "keeps legacy `status` compatible during
-- migration" means no existing writer should have to learn about the new column.
-- So the bridge is applied by the database on INSERT. It DERIVES the closure —
-- it does not let anyone hand-set it — which is the same discipline the
-- application writer follows, expressed where every writer must pass.
--
-- INSERT only, deliberately. On UPDATE the invariant stays strict, because the
-- application has exactly one writer of this axis (findingLifecycle.ts) and it
-- already carries both columns across the closure boundary together. A legacy
-- UPDATE that trips the CHECK is a bug we WANT to see, loudly, not one to paper
-- over with a trigger.

CREATE OR REPLACE FUNCTION findings_derive_closure_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('closed', 'accepted') THEN
    NEW.operational_status := 'closed';
  ELSIF NEW.operational_status = 'closed' THEN
    -- The other direction: a caller that knows the new axis but not the old one.
    NEW.status := 'closed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_findings_derive_closure_on_insert ON findings;

CREATE TRIGGER trg_findings_derive_closure_on_insert
  BEFORE INSERT ON findings
  FOR EACH ROW
  EXECUTE FUNCTION findings_derive_closure_on_insert();
