-- Migration: findings_intelligence_event
-- Package: Intelligence Pipeline Hardening / IE.P6
-- Memo: docs/architecture/erip/IE-INTELLIGENCE-EVENTS-MEMO.md (IE-AD-7)
--
-- Enables event-scoped findings that DEDUP BY UPDATE (goal item 7): one finding
-- per (organization, intelligence_event), updated as the event evolves rather
-- than duplicated on every re-projection. The legacy per-signal matcher path
-- (source_type='cyber_signal', no ON CONFLICT) is UNTOUCHED — this is an additive
-- parallel channel, dark behind SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED.
--
-- Two additive changes, no data migration:
--   1. findings.source_type CHECK gains 'intelligence_event' (additive expansion;
--      precedent: 20260716 added 'risk', 20260810 added 'asset_assessment').
--   2. A PARTIAL UNIQUE index on (organization_id, source_id) WHERE
--      source_type='intelligence_event' — the dedup key that makes an
--      INSERT ... ON CONFLICT DO UPDATE upsert one finding per (org, event).
--      Partial so it constrains ONLY event-sourced findings and never collides
--      with cyber_signal / manual / assessment findings that reuse source_id.
--
-- Additive + idempotent. Reversible:
--   DROP INDEX IF EXISTS idx_findings_intelligence_event_unique;
--   (and re-narrow the CHECK to the pre-existing list if desired).

ALTER TABLE findings
  DROP CONSTRAINT IF EXISTS findings_source_type_check;

ALTER TABLE findings
  ADD CONSTRAINT findings_source_type_check
    CHECK (source_type IN (
      'assessment',
      'control_test',
      'vendor_review',
      'vendor_cycle_review',
      'ai_review',
      'ai_governance_review',
      'obligation_review',
      'dependency_review',
      'cyber_signal',
      'signal',
      'manual',
      'risk',
      'applicability_assessment',
      'asset_assessment',
      'intelligence_event'
    ));

-- One event-sourced finding per (org, event). Enables ON CONFLICT DO UPDATE so an
-- evolving event updates its finding instead of creating a duplicate (IE-AD-7).
CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_intelligence_event_unique
  ON findings (organization_id, source_id)
  WHERE source_type = 'intelligence_event';
