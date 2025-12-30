import type { AuditSprintResultV1 } from "../result/AuditSprintResult.v1";

describe("AuditSprintResultV1 contract", () => {
  it("exposes all required fields", () => {
    const shape: Record<keyof AuditSprintResultV1, true> = {
      kind: true,
      version: true,
      meta: true,
      executionContext: true,
      scoring: true,
      executiveSummary: true,
      findings: true,
      riskRollup: true,
      remediationPlan: true,
      controlTraces: true,
      domains: true,
      summary: true,
      evidence: true,
      evidenceLinks: true,
      attestations: true,
      integrity: true
    };

    expect(shape).toBeTruthy();
  });
});
