import type { AuditSprintResultV1 } from "../audit/result/AuditSprintResult.v1";

export function gateAuditResultByEntitlement(
  result: AuditSprintResultV1,
  tier: "FREE" | "PRO" | "ENTERPRISE"
): AuditSprintResultV1 {
  if (tier === "ENTERPRISE") {
    return result;
  }

  const {
    remediationPlan,
    controlTraces,
    evidence,
    evidenceLinks,
    attestations,
    ...allowed
  } = result;

  return {
    ...allowed,
    integrity: result.integrity,
  } as AuditSprintResultV1;
}
