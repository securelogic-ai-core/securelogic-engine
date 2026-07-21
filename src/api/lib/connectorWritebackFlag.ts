/**
 * connectorWritebackFlag.ts — ERIP Epic 2 (E2a): the bidirectional-writeback
 * feature flag (ERIP-AD-12). Gates the writeback worker's due-intent scan AND
 * the writeback enqueue/list routes — the third fence on top of
 * SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED and SECURELOGIC_ASSET_REGISTRY_ENABLED.
 *
 * Writeback is the only path that MUTATES an external system, so it is fenced
 * separately from read-only discovery: an operator can run discovery/sync for a
 * long time before ever enabling outbound writes.
 *
 * DEFAULT OFF everywhere. Strict `=== "true"` predicate (the ECL shape) — no
 * NODE_ENV escape hatch. Prod enablement is out of scope for the ERIP program
 * (GATE B posture).
 */

export function connectorWritebackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_CONNECTOR_WRITEBACK_ENABLED"] === "true";
}
