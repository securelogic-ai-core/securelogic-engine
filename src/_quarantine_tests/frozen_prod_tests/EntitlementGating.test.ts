import { enforceEntitlements } from "../entitlement/enforceEntitlements";
import type { AuditSprintResultV1 } from "../contracts/result";
import type { Entitlements } from "../contracts/entitlement/Entitlements";

describe("Entitlement enforcement", () => {
  const baseResult = {
    meta: {
      version: "audit-sprint-result-v1",
      generatedAt: "2025-01-01",
      licenseTier: "CORE"
    },
    executionContext: {} as any,
    scoring: {} as any,
    executiveSummary: {} as any,
    findings: [],
    riskRollup: {} as any,
    remediationPlan: {} as any,
    controlTraces: [],
    evidence: [],
    evidenceLinks: [],
    attestations: []
  };

  it("removes gated fields for CORE tier", () => {
    const entitlements: Entitlements = {
      executiveSummary: true,
      findings: true,
      riskRollup: true,
      remediationPlan: false,
      evidence: false,
      evidenceLinks: false,
      controlTraces: false,
      attestations: false,
      export: { pdf: false, json: false }
    };

    const gated = enforceEntitlements(
      baseResult as Omit<AuditSprintResultV1, "integrity">,
      entitlements
    );

    expect("remediationPlan" in gated).toBe(false);
    expect("controlTraces" in gated).toBe(false);
    expect("evidence" in gated).toBe(false);
    expect("attestations" in gated).toBe(false);
  });
});
