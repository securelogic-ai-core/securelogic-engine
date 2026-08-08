-- EG2 Tier 2 slice 7 — assignment notifications.
--
-- Adds the per-user opt-out for "you were assigned a finding/action" emails.
-- Default TRUE (opted in), matching every other alert preference: the
-- enterprise expectation (ServiceNow/Archer/Jira) is that assignment notifies
-- unless the user turns it off. Additive only; existing rows inherit the
-- default; the alert_sends ledger (20260522) already dedupes per
-- (user, alert_type, reference_id) so no new ledger table is needed.
ALTER TABLE user_alert_preferences
  ADD COLUMN IF NOT EXISTS assignment_immediate BOOLEAN NOT NULL DEFAULT TRUE;
