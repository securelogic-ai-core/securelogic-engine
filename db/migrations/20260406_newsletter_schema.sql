-- Newsletter infrastructure schema additions.
--
-- Context:
-- The newsletter pipeline code (postgresIssueStore, newsletterDeliveryGenerator,
-- newsletterGenerator) references columns and a table that were never added to the
-- base schema. This migration closes all of those gaps.
--
-- Design decisions:
-- - email_suppressions is a platform-level suppression list (no org scoping needed).
-- - organization_id on newsletter_issues/subscribers/newsletter_deliveries is nullable:
--   NULL means platform-level (visible to all orgs), non-null means org-specific.
-- - The unique index on newsletter_deliveries prevents duplicate delivery records
--   per (issue, subscriber) pair, matching the ON CONFLICT clause in the pipeline.
-- - All statements use IF NOT EXISTS so this migration is safe to re-run.

-- =========================================================
-- EMAIL SUPPRESSIONS
-- Referenced by admin routes and the newsletter delivery pipeline.
-- =========================================================

CREATE TABLE IF NOT EXISTS email_suppressions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT        NOT NULL,
  reason     TEXT,
  source     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_email
  ON email_suppressions (LOWER(email));

-- =========================================================
-- NEWSLETTER ISSUES — org scoping
-- =========================================================

ALTER TABLE newsletter_issues
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_newsletter_issues_org
  ON newsletter_issues (organization_id);

-- =========================================================
-- SUBSCRIBERS — org scoping
-- Existing rows and platform-level subscribers have NULL org.
-- =========================================================

ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_subscribers_org
  ON subscribers (organization_id);

-- =========================================================
-- NEWSLETTER DELIVERIES — org scoping + dedup constraint
-- =========================================================

ALTER TABLE newsletter_deliveries
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_newsletter_deliveries_issue_subscriber
  ON newsletter_deliveries (issue_id, subscriber_email);
