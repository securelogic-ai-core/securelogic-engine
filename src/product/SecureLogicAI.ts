import type { ScoringInput } from "../engine/contracts/ScoringInput";
import type { LicenseContext } from "./contracts/LicenseContext";
import type { AuditSprintResultV1 } from "./contracts/result/AuditSprintResultV1";

import { runScoring } from "../engine/scoring";
import { buildExecutiveSummary } from "./builders/buildExecutiveSummary";
import { buildRemediationPlan } from "./builders/buildRemediationPlan";
import { buildFindings } from "./builders/buildFindings";
import { buildRiskRollup } from "./risk/buildRiskRollup";
import { buildControlTraces } from "./builders/buildControlTraces";
import { buildExecutionContext } from "./context/buildExecutionContext";

import { ENTITLEMENT_CATALOG } from "./entitlement/EntitlementCatalog";
import { enforceEntitlements } from "./entitlement/enforceEntitlements";
import { finalizeAuditSprintResult } from "./factories/AuditSprintResultFactory";

export class SecureLogicAI {
  constructor(private readonly license: LicenseContext) {}

  runAuditSprint(
    input: ScoringInput
  ): Readonly<AuditSprintResultV1> {
    const scoring = runScoring(input);

    const findings = buildFindings(scoring);
    const riskRollup = buildRiskRollup(findings);
    const controlTraces = buildControlTraces(scoring, findings);

    const draftResult: Omit<AuditSprintResultV1, "integrity"> = {
      meta: {
        version: "audit-sprint-result-v1",
        generatedAt: new Date().toISOString(),
        licenseTier: this.license.tier
      },
      executionContext: buildExecutionContext(),
      scoring,
      findings,
      riskRollup,
      controlTraces,
      executiveSummary: buildExecutiveSummary(scoring),
      remediationPlan: buildRemediationPlan(scoring),
      evidence: [],
      evidenceLinks: [],
      attestations: []
    };

    const entitlements =
      ENTITLEMENT_CATALOG[this.license.tier];

    const gated =
      enforceEntitlements(draftResult, entitlements);

    return finalizeAuditSprintResult(gated);
  }
}
