import type { AuditSprintResultV1 } from "../contracts/result/AuditSprintResultV1";
import type { Entitlements } from "../contracts/entitlement/Entitlements";

/**
 * Enforce entitlements on a PRE-INTEGRITY result.
 * exactOptionalPropertyTypes SAFE.
 */
export function enforceEntitlements(
  draft: Omit<AuditSprintResultV1, "integrity">,
  entitlements: Entitlements
): Omit<AuditSprintResultV1, "integrity"> {
  return {
    meta: draft.meta,
    executionContext: draft.executionContext,
    scoring: draft.scoring,

    ...(entitlements.executiveSummary && draft.executiveSummary
      ? { executiveSummary: draft.executiveSummary }
      : {}),

    ...(entitlements.remediationPlan && draft.remediationPlan
      ? { remediationPlan: draft.remediationPlan }
      : {}),

    ...(entitlements.findings && draft.findings
      ? { findings: draft.findings }
      : {}),

    ...(entitlements.riskRollup && draft.riskRollup
      ? { riskRollup: draft.riskRollup }
      : {}),

    ...(entitlements.controlTraces && draft.controlTraces
      ? { controlTraces: draft.controlTraces }
      : {}),

    ...(entitlements.evidence && draft.evidence
      ? { evidence: draft.evidence }
      : {}),

    ...(entitlements.evidenceLinks && draft.evidenceLinks
      ? { evidenceLinks: draft.evidenceLinks }
      : {}),

    ...(entitlements.attestations && draft.attestations
      ? { attestations: draft.attestations }
      : {})
  };
}
