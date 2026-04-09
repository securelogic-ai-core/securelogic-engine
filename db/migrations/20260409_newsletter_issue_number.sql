-- Add issue_number to newsletter_issues.
--
-- Design:
--   - issue_number is a human-readable sequential identifier (Issue #1, #2, …)
--   - Existing rows are backfilled in chronological order: oldest issue = #1
--   - New rows auto-increment via a dedicated sequence
--   - Unique index allows NULLs (safe for any edge-case rows that pre-date this migration)
--
-- Does not touch any other table.

ALTER TABLE newsletter_issues
  ADD COLUMN IF NOT EXISTS issue_number INT;

-- Backfill: assign sequential numbers ordered oldest-first
WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST) AS n
  FROM newsletter_issues
  WHERE issue_number IS NULL
)
UPDATE newsletter_issues ni
SET issue_number = numbered.n
FROM numbered
WHERE ni.id = numbered.id;

-- Create sequence positioned after current maximum
CREATE SEQUENCE IF NOT EXISTS newsletter_issue_number_seq;

SELECT setval(
  'newsletter_issue_number_seq',
  GREATEST(COALESCE((SELECT MAX(issue_number) FROM newsletter_issues), 0) + 1, 1),
  false  -- is_called=false → next nextval() returns this value
);

-- Wire sequence as the column default for future inserts
ALTER TABLE newsletter_issues
  ALTER COLUMN issue_number SET DEFAULT nextval('newsletter_issue_number_seq');

-- Unique index (partial on non-NULL only)
CREATE UNIQUE INDEX IF NOT EXISTS uq_newsletter_issues_issue_number
  ON newsletter_issues (issue_number)
  WHERE issue_number IS NOT NULL;
