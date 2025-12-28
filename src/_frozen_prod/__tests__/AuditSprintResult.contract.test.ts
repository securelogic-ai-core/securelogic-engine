import type { AuditSprintResultV1 } from "../contracts/result";

describe("AuditSprintResultV1 public contract", () => {
  it("must not change without a version bump", () => {
    const shape: Record<keyof AuditSprintResultV1, true> = {
      meta: true,
      executionContext: true,
      scoring: true,
      executiveSummary: true,
      findings: true,
      riskRollup: true,
      remediationPlan: true,
      controlTraces: true,
      evidence: true,
      evidenceLinks: true,
      attestations: true,
      integrity: true
    };

    expect(Object.keys(shape).sort()).toEqual([
      "attestations",
      "controlTraces",
      "evidence",
      "evidenceLinks",
      "executionContext",
      "executiveSummary",
      "findings",
      "integrity",
      "meta",
      "remediationPlan",
      "riskRollup",
      "scoring"
    ]);
  });
});
