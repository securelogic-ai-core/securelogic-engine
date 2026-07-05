
-- Migration: phase2_asset_targets
-- Package: Enterprise Asset Registry — Phase 2 (generalize the chokepoints)
--
-- EAR-AD-3 executed for the matcher/applicability plane: the quartet target
-- enums take ONE final generic value ('asset') and STOP GROWING — every new
-- matchable type from here on targets the Tier-0 registry by asset_id instead
-- of minting a per-type enum value + typed link table. Additive only; every
-- existing row, CHECK value, and consumer is unchanged.
--
--   1. signal_match_suggestions / applicability_assessments gain a nullable
--      asset_id (FK → assets ON DELETE SET NULL, the Phase-1 back-pointer
--      pattern). NOT part of the WORM content hash (the hash binds
--      (target_type, target_id), which uniquely identify the target;
--      asset_id is a resolvable compat pointer — see
--      applicabilityAssessmentWriter.ts).
--   2. The three target_type CHECKs (suggestions, assessments,
--      affected_entities.via_target_type) widen with 'asset'. Rows with
--      target_type='asset' carry the registry id in target_id and (on
--      suggestions/assessments) the asset_id pointer.
--   3. signal_asset_links: a read-only VIEW unifying the four typed link
--      tables (ECL AD-13 — the typed tables stay authoritative; §3.1 WRAP).
--      vendor/ai_system arms resolve asset_id through the registry;
--      control/obligation arms emit NULL (canonical GRC objects, not assets).
--
-- Dark posture: nothing writes target_type='asset' until the generic asset
-- matcher (flag-gated, SECURELOGIC_ASSET_REGISTRY_ENABLED) and the
-- ECL-flagged reassessment worker do; the view is read by nothing yet.

ALTER TABLE signal_match_suggestions
  ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES assets(id) ON DELETE SET NULL;

ALTER TABLE applicability_assessments
  ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES assets(id) ON DELETE SET NULL;

ALTER TABLE signal_match_suggestions
  DROP CONSTRAINT IF EXISTS signal_match_suggestions_target_type_chk;
ALTER TABLE signal_match_suggestions
  ADD CONSTRAINT signal_match_suggestions_target_type_chk
    CHECK (target_type IN ('vendor', 'ai_system', 'control', 'obligation', 'asset'));

ALTER TABLE applicability_assessments
  DROP CONSTRAINT IF EXISTS applicability_assessments_target_type_chk;
ALTER TABLE applicability_assessments
  ADD CONSTRAINT applicability_assessments_target_type_chk
    CHECK (target_type IN ('vendor', 'ai_system', 'control', 'obligation', 'asset'));

ALTER TABLE applicability_affected_entities
  DROP CONSTRAINT IF EXISTS applicability_affected_entities_via_target_type_chk;
ALTER TABLE applicability_affected_entities
  ADD CONSTRAINT applicability_affected_entities_via_target_type_chk
    CHECK (via_target_type IN ('vendor', 'ai_system', 'control', 'obligation', 'asset'));

-- Unified read surface over the four typed link tables (AD-13: they remain
-- authoritative — this is projection, not storage).
CREATE OR REPLACE VIEW signal_asset_links AS
  SELECT
    l.id                    AS link_id,
    l.organization_id       AS organization_id,
    l.signal_id             AS signal_id,
    'vendor'::text          AS target_type,
    l.vendor_id             AS target_id,
    a.id                    AS asset_id,
    l.created_by_user_id    AS created_by_user_id
  FROM signal_vendor_links l
  LEFT JOIN assets a
    ON a.backing_kind = 'vendors' AND a.backing_id = l.vendor_id
   AND a.organization_id = l.organization_id
  UNION ALL
  SELECT
    l.id, l.organization_id, l.signal_id,
    'ai_system'::text, l.ai_system_id,
    a.id, l.created_by_user_id
  FROM signal_ai_system_links l
  LEFT JOIN assets a
    ON a.backing_kind = 'ai_systems' AND a.backing_id = l.ai_system_id
   AND a.organization_id = l.organization_id
  UNION ALL
  SELECT
    l.id, l.organization_id, l.signal_id,
    'control'::text, l.control_id,
    NULL::uuid, l.created_by_user_id
  FROM signal_control_links l
  UNION ALL
  SELECT
    l.id, l.organization_id, l.signal_id,
    'obligation'::text, l.obligation_id,
    NULL::uuid, l.created_by_user_id
  FROM signal_obligation_links l;

-- Same defense-in-depth as asset_registry_v (20260802): invoker semantics on
-- PG >= 15 so the caller's role/RLS apply through the view.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'ALTER VIEW signal_asset_links SET (security_invoker = true)';
  END IF;
END $$;

GRANT SELECT ON signal_asset_links TO app_request;
