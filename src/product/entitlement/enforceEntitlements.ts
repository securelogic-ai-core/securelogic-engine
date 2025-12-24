import type { AuditSprintResultV1 } from "../contracts/result/AuditSprintResultV1";
import type { Entitlements } from "../contracts/entitlement/Entitlements";

/**
 * Enforce entitlements on a PRE-INTEGRITY, PRE-VERSION result.
 * Properties are OMITTED, never set to undefined.
 */
export function enforceEntitlements(
  draft: Omit<AuditSprintResultV1, "integrity" | "kind" | "version">,
  entitlements: Entitlements
): Omit<AuditSprintResultV1, "integrity" | "kind" | "version"> {
  const result: any = { ...draft };

  if (!entitlements.executiveSummary) delete result.executiveSummary;
  if (!entitlements.remediationPlan) delete result.remediationPlan;
  if (!entitlements.controlTraces) delete result.controlTraces;
  if (!entitlements.evidence) delete result.evidence;
  if (!entitlements.evidenceLinks) delete result.evidenceLinks;
  if (!entitlements.attestations) delete result.attestations;

  return result;
}
