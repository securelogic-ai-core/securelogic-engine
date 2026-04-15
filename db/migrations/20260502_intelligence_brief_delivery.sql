-- ============================================================
-- Intelligence Brief Delivery Layer
-- 2026-05-02
--
-- 1. Extend intelligence_brief_items with analyst-enrichment columns
-- 2. intelligence_brief_subscribers — per-org subscriber list
-- 3. intelligence_brief_sends       — delivery audit trail
-- ============================================================

-- ------------------------------------------------------------
-- 1. intelligence_brief_items — analyst enrichment columns
--
-- why_it_matters:      2-3 sentence real-world significance (AI or human)
-- recommended_actions: concise practitioner action list
-- analyst_notes:       optional freeform context (AI or human edited)
--
-- All nullable — absence means the enrichment step has not run or
-- the item was generated before this migration.
-- ------------------------------------------------------------

ALTER TABLE intelligence_brief_items
  ADD COLUMN IF NOT EXISTS why_it_matters     TEXT,
  ADD COLUMN IF NOT EXISTS recommended_actions TEXT,
  ADD COLUMN IF NOT EXISTS analyst_notes      TEXT;

-- ------------------------------------------------------------
-- 2. intelligence_brief_subscribers
--    Per-org subscriber list for Intelligence Brief email delivery.
--    Unique on (organization_id, email) — one subscription per address.
--    Soft-delete via active=false + unsubscribed_at rather than hard delete.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intelligence_brief_subscribers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email            TEXT        NOT NULL,
  name             TEXT,
  active           BOOLEAN     NOT NULL DEFAULT TRUE,
  subscribed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unsubscribed_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT intelligence_brief_subscribers_email_check
    CHECK (email = LOWER(TRIM(email))),

  CONSTRAINT intelligence_brief_subscribers_uq
    UNIQUE (organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_brief_subscribers_org_active
  ON intelligence_brief_subscribers (organization_id, active);

-- ------------------------------------------------------------
-- 3. intelligence_brief_sends
--    Audit trail: one row per (brief, subscriber) send attempt.
--    Retained even after a subscriber unsubscribes.
--    status: 'sent' | 'failed'
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intelligence_brief_sends (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id        UUID        NOT NULL REFERENCES intelligence_briefs(id) ON DELETE CASCADE,
  subscriber_id   UUID        NOT NULL REFERENCES intelligence_brief_subscribers(id) ON DELETE CASCADE,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          TEXT        NOT NULL DEFAULT 'sent',
  error_message   TEXT,

  CONSTRAINT intelligence_brief_sends_status_check
    CHECK (status IN ('sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_brief_sends_brief_id
  ON intelligence_brief_sends (brief_id);

CREATE INDEX IF NOT EXISTS idx_brief_sends_subscriber_id
  ON intelligence_brief_sends (subscriber_id);

CREATE INDEX IF NOT EXISTS idx_brief_sends_sent_at
  ON intelligence_brief_sends (sent_at DESC);
