-- ============================================================
-- Add 'suppressed' status to intelligence_brief_sends
-- 2026-05-14
--
-- Allows the brief send pipeline to record suppressed deliveries
-- (subscriber email is in email_suppressions) as a distinct outcome
-- separate from 'failed' (transient send error).
-- ============================================================

ALTER TABLE intelligence_brief_sends
  DROP CONSTRAINT IF EXISTS intelligence_brief_sends_status_check;

ALTER TABLE intelligence_brief_sends
  ADD CONSTRAINT intelligence_brief_sends_status_check
    CHECK (status IN ('sent', 'failed', 'suppressed'));
