-- EG2 Tier 2 slice 11 — SLA-breach notifications.
--
-- Per-user opt-out for the daily "work you own went overdue" email. Default
-- TRUE (opted in) like every other alert preference. Additive only; the
-- alert_sends ledger (20260522) dedupes per (user, alert_type, reference_id)
-- where reference_id embeds the item's due date, so an extended-then-
-- rebreached item re-notifies while a repeat sweep never does.
ALTER TABLE user_alert_preferences
  ADD COLUMN IF NOT EXISTS sla_breach_daily BOOLEAN NOT NULL DEFAULT TRUE;
