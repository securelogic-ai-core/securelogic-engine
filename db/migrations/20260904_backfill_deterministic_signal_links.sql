-- 20260904_backfill_deterministic_signal_links.sql
--
-- Backfill the signal→entity LINKS that the matcher should always have written.
--
-- WHY
--   cyberSignalProcessingService creates a `cyber_signal` finding ONLY when its
--   Phase-1 canonical-EXACT match hits a vendor or AI system, and titles that
--   finding "<CVE> affects vendor: <name>". But it recorded the match only as a
--   row in signal_match_suggestions — it never wrote signal_vendor_links /
--   signal_ai_system_links.
--
--   findingContextResolver.affected() and findingEntitySearch read the LINK
--   tables and nothing else. So every auto-generated signal finding in the
--   product today shows "Vendors (0) — No affected vendors" beneath a title that
--   names the vendor, and is invisible to a Risk Findings search for that
--   vendor's name. The code fix (this migration's companion) makes the matcher
--   write the link going forward. This migration repairs the existing corpus,
--   which would otherwise stay broken forever — no customer is going to hand-
--   accept a thousand queue items.
--
-- SCOPE — deliberately narrow. Only PENDING suggestions from the two
-- DETERMINISTIC branches are promoted:
--     match_reason = 'vendor_name_ilike'      (Phase 1 vendor, exact canonical)
--     match_reason = 'ai_system_name_ilike'   (Phase 1 AI system, exact canonical)
--
--   NOT promoted, on purpose:
--     'vendor_fuzzy_match'  — token-similarity guess; a human must still judge it
--     obligation matches    — score-based (scoreObligationMatch), genuinely uncertain
--     'asset_name_canonical'— the dark asset-registry branch
--     anything DISMISSED    — a human said no; that decision is final and is
--                             never resurrected (the WHERE clause below only
--                             touches rows with dismissed_at IS NULL)
--
-- SAFETY
--   Idempotent: NOT EXISTS guards on the link inserts, and the UPDATE only moves
--   rows that are still pending. Re-running is a no-op.
--   Reversible: links carry deleted_at (soft delete). To undo, soft-delete the
--   rows whose note = 'Backfilled: <branch>' and reset those suggestions to
--   pending (accepted_at = NULL, accepted_link_id = NULL).
--   Additive only: no schema change, no DROP, no data destroyed. Existing
--   human-created links are left untouched (the NOT EXISTS sees them and skips).

BEGIN;

-- 1. Vendor links from pending deterministic vendor suggestions.
INSERT INTO signal_vendor_links (organization_id, signal_id, vendor_id, note, created_by_user_id)
SELECT DISTINCT
  s.organization_id,
  s.signal_id,
  s.target_id,
  'Backfilled: ' || s.match_reason,
  NULL::uuid
FROM signal_match_suggestions s
JOIN vendors v
  ON v.id = s.target_id
 AND v.organization_id = s.organization_id
WHERE s.target_type = 'vendor'
  AND s.match_reason = 'vendor_name_ilike'
  AND s.accepted_at IS NULL
  AND s.dismissed_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM signal_vendor_links l
     WHERE l.organization_id = s.organization_id
       AND l.signal_id = s.signal_id
       AND l.vendor_id = s.target_id
       AND l.deleted_at IS NULL
  );

-- 2. AI-system links from pending deterministic AI suggestions.
INSERT INTO signal_ai_system_links (organization_id, signal_id, ai_system_id, note, created_by_user_id)
SELECT DISTINCT
  s.organization_id,
  s.signal_id,
  s.target_id,
  'Backfilled: ' || s.match_reason,
  NULL::uuid
FROM signal_match_suggestions s
JOIN ai_systems a
  ON a.id = s.target_id
 AND a.organization_id = s.organization_id
WHERE s.target_type = 'ai_system'
  AND s.match_reason = 'ai_system_name_ilike'
  AND s.accepted_at IS NULL
  AND s.dismissed_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM signal_ai_system_links l
     WHERE l.organization_id = s.organization_id
       AND l.signal_id = s.signal_id
       AND l.ai_system_id = s.target_id
       AND l.deleted_at IS NULL
  );

-- 3. Mark those suggestions accepted, pointing at the link that now carries the
--    association. accepted_by_user_id stays NULL = machine-accepted. The row is
--    kept as the audit trail of how the link came to exist.
--    signal_match_suggestions_state_chk requires accepted_at and accepted_link_id
--    to be set together, so both move in one statement.
UPDATE signal_match_suggestions s
   SET accepted_at = NOW(),
       accepted_link_id = l.id
  FROM signal_vendor_links l
 WHERE l.organization_id = s.organization_id
   AND l.signal_id = s.signal_id
   AND l.vendor_id = s.target_id
   AND l.deleted_at IS NULL
   AND s.target_type = 'vendor'
   AND s.match_reason = 'vendor_name_ilike'
   AND s.accepted_at IS NULL
   AND s.dismissed_at IS NULL;

UPDATE signal_match_suggestions s
   SET accepted_at = NOW(),
       accepted_link_id = l.id
  FROM signal_ai_system_links l
 WHERE l.organization_id = s.organization_id
   AND l.signal_id = s.signal_id
   AND l.ai_system_id = s.target_id
   AND l.deleted_at IS NULL
   AND s.target_type = 'ai_system'
   AND s.match_reason = 'ai_system_name_ilike'
   AND s.accepted_at IS NULL
   AND s.dismissed_at IS NULL;

COMMIT;
