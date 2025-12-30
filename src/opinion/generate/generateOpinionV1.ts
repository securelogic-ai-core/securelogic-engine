import type { OpinionV1 } from "../OpinionV1";
import type { AuditSprintResultV1 } from "../../_frozen_prod/result/AuditSprintResult.v1";

export function generateOpinionV1(
  result: AuditSprintResultV1
): OpinionV1 {
  const risk = (result.riskRollup as any)?.level ?? "LOW";

  const verdict =
    risk === "CRITICAL"
      ? "CRITICAL"
      : risk === "HIGH"
      ? "DEFICIENT"
      : risk === "MEDIUM"
      ? "CONDITIONAL"
      : "ADEQUATE";

  return {
    kind: "SecureLogicOpinion",
    version: "v1",
    scope: "AI_GOVERNANCE",
    verdict,
    issuedAt: new Date().toISOString(),
    evidence: [
      {
        source: "AUDIT_RESULT",
        referenceId: result.version
      }
    ],
    signature: ""
  };
}
