-- 20261091_wa3_historical_question_version_freeze.sql
--
-- WA-3 (owner ruling 2026-09-05) — the historical content FREEZE.
--
-- ── What this is, and what it is NOT ────────────────────────────────────────
-- Ninety-three vendor-assessment scope items were composed before VA-Q1 P2
-- existed, so they carry no `question_version_id`. They render through the
-- COALESCE fallback in the portal and the reviewer surfaces —
-- `COALESCE(qv.prompt, r.title)` / `COALESCE(qv.guidance, r.description)` —
-- which means they read LIVE canonical requirement text. Editing the corpus
-- (WA-3 rulings 2/3/4) would therefore silently rewrite what a vendor was
-- asked on an assessment they have already answered.
--
-- This migration binds each of those items to question version 1 of its bridge
-- question, so the content stops moving.
--
-- It is a FREEZE, not a reconstruction. The provenance it establishes is:
--
--     "Frozen as of 2026-08-28T18:06:54Z, the earliest immutable content
--      record available."
--
-- It does NOT assert, and must never be described as asserting:
--   - reconstructed original text;
--   - proven issuance-time text;
--   - an exact reconstruction of the text as at composition;
--   - proof that the question had never previously changed.
--
-- The evidential limit is real and is recorded in
-- docs/validation/wa3-historical-corpus-determination-2026-09-05.md:
-- `requirements` has no `updated_at`, and application audit history does not
-- prove the absence of direct script/backfill mutation. What IS proven is that
-- the content each item renders immediately BEFORE this migration is
-- byte-identical to the v1 content it renders AFTER it.
--
-- ── The safety property ────────────────────────────────────────────────────
-- Zero vendor-visible change. An item is bound only when its v1 `prompt`
-- equals the requirement's current `title` AND its v1 `guidance` is not
-- distinct from the requirement's current `description`. Because that is
-- exactly what the COALESCE fallback was already returning, the rendered bytes
-- before and after are identical by construction. The post-conditions below
-- re-prove it on the committed rows rather than trusting the predicate.
--
-- Nothing is normalized to make a comparison succeed. Punctuation, whitespace,
-- casing and spelling are compared as stored; a mismatch fails the migration
-- rather than being smoothed away.
--
-- ── Why binding to v1 and never to `current_version` ───────────────────────
-- SOC 2 `A1.1` (`ae678fa6…`) has TWO versions. v2 holds
-- "EDITED ON STAGING AFTER ISSUE — this text must NOT reach the issued
-- questionnaire.", written by a deliberate ADR-0013 R3 immutability test on
-- 2026-08-28 and reverted 2.9 seconds later. `questions.current_version` for
-- it is 2. Binding by current_version would attach two historical items to
-- that sabotage text. v1 is the only correct target.
--
-- ── Bounded, one-time, fail-closed ─────────────────────────────────────────
-- This is a controlled historical bridge, NOT a standing policy of binding
-- unstamped rows to v1. The population is bounded three ways:
--   1. the item is unstamped;
--   2. its engagement is past issue (a pre-issue engagement re-resolves and
--      is versioned by the live composition path — it needs nothing here);
--   3. it was composed BEFORE the first immutable content record existed for
--      its own tenant. An org with no `question_versions` rows yields NULL
--      from that subquery, the predicate is false, and the migration is a
--      no-op — which is what a fresh database, a test harness, and an
--      environment where Vendor Assurance has never run all are.
--
-- If any item inside that population cannot be bound byte-identically, the
-- migration RAISES and the whole transaction rolls back. Migrations run one
-- per transaction (migrationRunner.ts:212), so a refusal leaves the database
-- exactly as it was.
--
-- No table is created, so there is no RLS/grant/classification work; the
-- temp table is transaction-scoped. Every join carries organization_id on both
-- legs, so a cross-tenant binding is structurally impossible.
--
-- Rollback: docs/release/ROLLBACK-20261091.sql

DO $$
DECLARE
  v_candidates INT;
  v_blocked    INT;
  v_items      INT;
  v_responses  INT;
  v_revisions  INT;
  v_leftover   INT;
  v_drift      INT;
BEGIN
  CREATE TEMP TABLE wa3_freeze_population ON COMMIT DROP AS
  SELECT si.id              AS item_id,
         si.organization_id AS organization_id,
         si.engagement_id   AS engagement_id,
         si.requirement_id  AS requirement_id,
         v1.id              AS v1_id,
         (v1.id IS NOT NULL
          AND v1.prompt = r.title
          AND v1.guidance IS NOT DISTINCT FROM r.description) AS bindable
    FROM vendor_engagement_scope_items si
    JOIN vendor_engagements e
      ON e.id = si.engagement_id
     AND e.organization_id = si.organization_id
    JOIN requirements r
      ON r.id = si.requirement_id
    -- The bridge question is addressed by its deterministic key. The fold
    -- mirrors bridgeQuestionKey() in questionContent.ts exactly; a key that
    -- does not resolve leaves v1_id NULL and blocks the migration rather than
    -- silently skipping the item.
    LEFT JOIN questions q
      ON q.organization_id = si.organization_id
     AND q.question_key = 'req:' || r.framework_id::text || ':' ||
         COALESCE(NULLIF(regexp_replace(regexp_replace(lower(r.reference_id),
           '[^a-z0-9._-]+', '-', 'g'), '^-+|-+$', '', 'g'), ''), 'x')
    LEFT JOIN question_versions v1
      ON v1.question_id = q.id
     AND v1.version = 1
     AND v1.organization_id = si.organization_id
   WHERE si.question_version_id IS NULL
     AND e.status NOT IN ('draft', 'scoping', 'scoped', 'cancelled')
     AND si.created_at < (SELECT MIN(qv.published_at)
                            FROM question_versions qv
                           WHERE qv.organization_id = si.organization_id);

  SELECT COUNT(*), COUNT(*) FILTER (WHERE NOT bindable)
    INTO v_candidates, v_blocked
    FROM wa3_freeze_population;

  IF v_candidates = 0 THEN
    RAISE NOTICE 'WA-3 freeze: no pre-P2 historical scope items in this database; nothing to do.';
    RETURN;
  END IF;

  -- Fail closed. Not "skip the awkward ones".
  IF v_blocked > 0 THEN
    RAISE EXCEPTION
      'WA-3 freeze refused: % of % historical scope items have no byte-identical version 1 '
      '(missing bridge question, missing v1, or content drift). Binding them would fabricate '
      'history. Investigate before re-running; see '
      'docs/validation/wa3-historical-corpus-determination-2026-09-05.md.',
      v_blocked, v_candidates;
  END IF;

  -- 1. The assessment items. This is the binding that stops the content moving.
  UPDATE vendor_engagement_scope_items si
     SET question_version_id = p.v1_id
    FROM wa3_freeze_population p
   WHERE si.id = p.item_id
     AND si.organization_id = p.organization_id
     AND si.question_version_id IS NULL;
  GET DIAGNOSTICS v_items = ROW_COUNT;

  -- 2. The answers, bound through their items to the same frozen semantics.
  --    Only the version pointer is written. Status, notes, assessed_at,
  --    assessed_by and updated_at are untouched, and no trigger on this table
  --    rewrites them.
  UPDATE requirement_responses rr
     SET question_version_id = p.v1_id
    FROM wa3_freeze_population p
   WHERE rr.engagement_id   = p.engagement_id
     AND rr.requirement_id  = p.requirement_id
     AND rr.organization_id = p.organization_id
     AND rr.question_version_id IS NULL;
  GET DIAGNOSTICS v_responses = ROW_COUNT;

  -- 3. Their revision history, so a reopened answer's trail carries the same
  --    content identity as the answer itself.
  UPDATE requirement_response_revisions rev
     SET question_version_id = sub.v1_id
    FROM (SELECT rr.id AS response_id, rr.organization_id, p.v1_id
            FROM requirement_responses rr
            JOIN wa3_freeze_population p
              ON p.engagement_id   = rr.engagement_id
             AND p.requirement_id  = rr.requirement_id
             AND p.organization_id = rr.organization_id) sub
   WHERE rev.response_id = sub.response_id
     AND rev.organization_id = sub.organization_id
     AND rev.question_version_id IS NULL;
  GET DIAGNOSTICS v_revisions = ROW_COUNT;

  -- ── Post-conditions. Proven on committed rows, not assumed. ──────────────

  IF v_items <> v_candidates THEN
    RAISE EXCEPTION 'WA-3 freeze: bound % items but the population was %.', v_items, v_candidates;
  END IF;

  SELECT COUNT(*) INTO v_leftover
    FROM vendor_engagement_scope_items si
    JOIN wa3_freeze_population p ON p.item_id = si.id
   WHERE si.question_version_id IS NULL;
  IF v_leftover > 0 THEN
    RAISE EXCEPTION 'WA-3 freeze: % population items remain unstamped.', v_leftover;
  END IF;

  -- The non-mutation proof: what each bound item renders now must be exactly
  -- what it rendered through the fallback before.
  SELECT COUNT(*) INTO v_drift
    FROM vendor_engagement_scope_items si
    JOIN wa3_freeze_population p  ON p.item_id = si.id
    JOIN requirements r           ON r.id = si.requirement_id
    JOIN question_versions qv     ON qv.id = si.question_version_id
                                 AND qv.organization_id = si.organization_id
   WHERE qv.prompt IS DISTINCT FROM r.title
      OR qv.guidance IS DISTINCT FROM r.description;
  IF v_drift > 0 THEN
    RAISE EXCEPTION 'WA-3 freeze: % bound items would render different bytes than before.', v_drift;
  END IF;

  RAISE NOTICE 'WA-3 freeze: % items, % responses, % revisions bound to version 1; rendered content unchanged.',
    v_items, v_responses, v_revisions;
END $$;
