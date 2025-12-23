import type { LicenseContext } from "./contracts/LicenseContext";
import type { ScoringInput } from "../engine/contracts/ScoringInput";
import type { AuditSprintResultV1 } from "./contracts/result";

import { runScoring } from "../engine/scoring";
import { buildExecutiveSummary } from "./builders/buildExecutiveSummary";
import { buildRemediationPlan } from "./builders/buildRemediationPlan";
import { buildFindings } from "./builders/buildFindings";
import { finalizeAuditSprintResult } from "./factories/AuditSprintResultFactory";

export class SecureLogicAI {
  constructor(private readonly license: LicenseContext) {}

  runAuditSprint(input: ScoringInput): Readonly<AuditSprintResultV1> {
    const scoring = runScoring(input);

    const result: Omit<AuditSprintResultV1, "integrity"> = {
      meta: {
        version: "audit-sprint-result-v1",
        generatedAt: new Date().toISOString(),
        licenseTier: this.license.tier
      },

      scoring,
      findings: buildFindings(scoring),
      executiveSummary: buildExecutiveSummary(scoring),
      remediationPlan: buildRemediationPlan(scoring)
    };

    return finalizeAuditSprintResult(result);
  }
}
