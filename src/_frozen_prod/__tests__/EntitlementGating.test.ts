import { gateEntitlements } from "../entitlements/gateEntitlements";
import type { AuditSprintResultV1 } from "../result/AuditSprintResult.v1";

describe("Entitlement gating", () => {
  it("blocks write actions for CORE", () => {
    const baseResult: AuditSprintResultV1 = {
      kind: "AuditSprintResult",
      version: "v1",
      meta: { licenseTier: "CORE" },
      executionContext: {},
      scoring: {},
      executiveSummary: {},
      findings: [],
      riskRollup: {},
      remediationPlan: {},
      controlTraces: [],
      domains: [],
      summary: {},
      evidence: [],
      evidenceLinks: [],
      attestations: [],
      integrity: {}
    };

    const result = gateEntitlements(baseResult, ["write"]);
    expect(result.allowed).toBe(false);
  });
});
