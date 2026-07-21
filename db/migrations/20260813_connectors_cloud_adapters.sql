-- Migration: widen enterprise_connectors.connector_id for native cloud adapters
-- Package: Enterprise Risk Intelligence Platform — Epic 2 (E2.P5)
-- Design authority: docs/architecture/erip/E2-DISCOVERY-CONNECTORS-MEMO.md (ERIP-AD-14)
--
-- Admits the three native cloud connector ids (aws / azure / gcp) into the
-- enterprise_connectors.connector_id CHECK. Per ERIP-AD-14 a new adapter is
-- only reachable once its id is admitted here — a deliberate migration gate,
-- kept in lockstep with REQUIRED_CONNECTOR_IDS (registry.ts, unit-asserted).
--
-- Widening only: every previously-admitted id is retained. No column, policy,
-- grant, or data change. DROP+ADD of the CHECK is the standard reshape for an
-- enum-style constraint (no rows are invalidated — the set only grows).
--
-- Rollback (manual, forward-only convention): drop the constraint and re-add
-- the prior 9-value CHECK (see 20260807 header for the original list). Only
-- safe once no aws/azure/gcp rows exist.

ALTER TABLE enterprise_connectors
  DROP CONSTRAINT IF EXISTS enterprise_connectors_connector_id_check;

ALTER TABLE enterprise_connectors
  ADD CONSTRAINT enterprise_connectors_connector_id_check
  CHECK (connector_id IN (
    'servicenow_cmdb',
    'microsoft_defender',
    'crowdstrike_falcon',
    'wiz',
    'tenable',
    'qualys',
    'rapid7',
    'cloud_inventory',
    'identity_provider',
    'aws',
    'azure',
    'gcp'));
