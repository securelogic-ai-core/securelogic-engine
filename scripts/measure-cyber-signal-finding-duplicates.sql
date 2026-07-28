-- D-14 measurement (#693): existing duplicate-findings volume from matcher
-- re-fires, BEFORE any backfill decision (Decision Review assumption #4).
--
-- Read-only. Run against production with a read replica or during low load:
--   psql "$DATABASE_URL" -f scripts/measure-cyber-signal-finding-duplicates.sql
--
-- The write-path guard shipped with this script prevents NEW duplicates; this
-- measures the legacy population so the operator can rule on dedup/backfill
-- (options: leave in place / close duplicates keeping the oldest / merge).

-- 1. Overall volume: how many (org, signal) groups have >1 finding, and how
--    many surplus rows exist in total.
SELECT
  COUNT(*)                            AS duplicated_groups,
  SUM(cnt - 1)                        AS surplus_finding_rows,
  MAX(cnt)                            AS worst_group_size
FROM (
  SELECT organization_id, source_id, COUNT(*) AS cnt
    FROM findings
   WHERE source_type = 'cyber_signal'
   GROUP BY organization_id, source_id
  HAVING COUNT(*) > 1
) g;

-- 2. Per-org breakdown (top 20) — who is affected and how badly.
SELECT
  organization_id,
  COUNT(*)         AS duplicated_groups,
  SUM(cnt - 1)     AS surplus_finding_rows
FROM (
  SELECT organization_id, source_id, COUNT(*) AS cnt
    FROM findings
   WHERE source_type = 'cyber_signal'
   GROUP BY organization_id, source_id
  HAVING COUNT(*) > 1
) g
GROUP BY organization_id
ORDER BY surplus_finding_rows DESC
LIMIT 20;

-- 3. Status mix of the surplus rows (everything newer than the oldest row in
--    each duplicated group) — tells us whether duplicates carry human state
--    (in_progress/accepted) that a naive close-newest backfill would destroy.
SELECT f.status, COUNT(*) AS surplus_rows
FROM findings f
JOIN (
  SELECT organization_id, source_id, MIN(created_at) AS first_created
    FROM findings
   WHERE source_type = 'cyber_signal'
   GROUP BY organization_id, source_id
  HAVING COUNT(*) > 1
) g
  ON g.organization_id = f.organization_id
 AND g.source_id = f.source_id
WHERE f.source_type = 'cyber_signal'
  AND f.created_at > g.first_created
GROUP BY f.status
ORDER BY surplus_rows DESC;
