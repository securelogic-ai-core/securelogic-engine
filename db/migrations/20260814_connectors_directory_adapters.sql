-- Migration: widen enterprise_connectors.connector_id for wave-2 adapters
-- Package: Enterprise Risk Intelligence Platform — Epic 2 (E2.P6)
-- Design authority: docs/architecture/erip/E2-DISCOVERY-CONNECTORS-MEMO.md (ERIP-AD-14)
--
-- Admits the four directory/device/repo connector ids (microsoft_graph /
-- google_workspace / github / jamf) into the enterprise_connectors.connector_id
-- CHECK. Per ERIP-AD-14 a new adapter is only reachable once its id is admitted
-- here — kept in lockstep with REQUIRED_CONNECTOR_IDS (registry.ts, unit-asserted).
--
-- Widening only: every previously-admitted id (through 20260813) is retained.
-- No column, policy, grant, or data change.
--
-- Rollback (manual, forward-only convention): drop the constraint and re-add
-- the prior 12-value CHECK (see 20260813). Safe only once no
-- microsoft_graph/google_workspace/github/jamf rows exist.

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
    'gcp',
    'microsoft_graph',
    'google_workspace',
    'github',
    'jamf'));
