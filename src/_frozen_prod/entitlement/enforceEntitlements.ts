import type { AuditSprintResultV1 } from "../contracts";
import type { Entitlements } from "./Entitlements";

/**
 * Enforces entitlements by removing gated fields at runtime.
 * Uses a single controlled unknown cast at the boundary.
 */
export function enforceEntitlements(
  result: AuditSprintResultV1,
  entitlements: Entitlements
): AuditSprintResultV1 {
  if (!entitlements.allowFindings) {
    const raw = result as unknown as Record<string, unknown>;

    delete raw.remediationPlan;
    delete raw.controlTraces;
    delete raw.evidence;
    delete raw.attestations;

    raw.domains = [];
    raw.findings = [];
  }

  if (!entitlements.allowExecutiveSummary) {
    const raw = result as unknown as Record<string, unknown>;
    delete raw.summary;
  }

  return result;
}
