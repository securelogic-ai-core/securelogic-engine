-- Migration: suggestions_intelligence_event
-- Package: Intelligence Pipeline Hardening (event-native matcher linkage)
-- Memo: docs/architecture/erip/IE-INTELLIGENCE-EVENTS-MEMO.md (IE-AD-11)
--
-- Makes the matcher-linkage layer event-native: signal_match_suggestions gains a
-- reference to the canonical Intelligence Event it concerns, so the accept/dismiss
-- workflow and every linkage service (vendor / AI system / control / obligation /
-- asset / application) reference the AUTHORITATIVE MODEL, not the raw ingestion
-- record. The existing signal_id column is PRESERVED (backward compatibility +
-- forensics/debugging) — this is additive, not a replacement.
--
-- INGESTION UNCHANGED: raw cyber_signals remain the ingestion record. The FK is
-- ON DELETE SET NULL so a signal/event lifecycle never breaks a suggestion.
--
-- DARK: the column stays NULL until the matcher runs event-native behind
-- SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED. Additive + idempotent.
-- Reversible:
--   DROP INDEX IF EXISTS idx_signal_match_suggestions_event;
--   ALTER TABLE signal_match_suggestions DROP COLUMN IF EXISTS intelligence_event_id;

ALTER TABLE signal_match_suggestions
  ADD COLUMN IF NOT EXISTS intelligence_event_id UUID NULL
    REFERENCES intelligence_events(id) ON DELETE SET NULL;

-- Org-scoped lookup by event (list an event's suggestions; resolve read paths).
CREATE INDEX IF NOT EXISTS idx_signal_match_suggestions_event
  ON signal_match_suggestions (organization_id, intelligence_event_id)
  WHERE intelligence_event_id IS NOT NULL;
