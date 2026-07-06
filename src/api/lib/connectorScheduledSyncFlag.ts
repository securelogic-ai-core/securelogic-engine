/**
 * connectorScheduledSyncFlag.ts — ERIP Epic 2 (E2.P1): the scheduled-sync
 * feature flag (ERIP-AD-9). Gates ONLY the worker's due-connector scan — the
 * third fence on top of SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED and
 * SECURELOGIC_ASSET_REGISTRY_ENABLED. Manual sync (POST /api/connectors/:id/sync)
 * is unaffected by this flag.
 *
 * DEFAULT OFF everywhere. Strict `=== "true"` predicate (the ECL shape) — no
 * NODE_ENV escape hatch. Prod enablement is out of scope for the ERIP program
 * (GATE B posture).
 */

export function connectorScheduledSyncEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_CONNECTOR_SCHEDULED_SYNC_ENABLED"] === "true";
}
