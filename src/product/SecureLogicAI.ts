import type { LicenseContext } from "./contracts/LicenseContext";
import type { ScoringInput } from "../engine/contracts/ScoringInput";
import type { AuditSprintResultV1 } from "./contracts/result";

import { runScoring } from "../engine/scoring";
import { buildExecutiveSummary } from "./builders/buildExecutiveSummary";
import { buildRemediationPlan } from "./builders/buildRemediationPlan";
import { LICENSE_ENTITLEMENTS } from "./contracts/LicenseEntitlements";
import { finalizeAuditSprintResult } from "./factories/AuditSprintResultFactory";

export class SecureLogicAI {
  constructor(private readonly license: LicenseContext) {}

  runAuditSprint(input: ScoringInput): Readonly<AuditSprintResultV1> {
    const scoring = runScoring(input);
    const entitlements = LICENSE_ENTITLEMENTS[this.license.tier];

    // Base object (no optional fields yet)
    const result: AuditSprintResultV1 = {
      meta: {
        version: "audit-sprint-result-v1",
        generatedAt: new Date().toISOString(),
        licenseTier: this.license.tier
      },
      scoring,
      entitlements: {
        executiveSummary: entitlements.executiveNarrative,
        remediationPlan: entitlements.remediationPlan
      }
    };

    // Conditionally attach optional fields (CORRECT way)
    if (entitlements.executiveNarrative) {
      result.executiveSummary = buildExecutiveSummary(scoring);
    }

    if (entitlements.remediationPlan) {
      result.remediationPlan = buildRemediationPlan(scoring);
    }

    return finalizeAuditSprintResult(result);
  }
}
