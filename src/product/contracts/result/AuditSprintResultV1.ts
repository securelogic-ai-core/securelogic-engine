/**
 * SecureLogic AI
 * =========================
 * Audit Sprint Result — V1
 *
 * ENTERPRISE, CLIENT-FACING, VERSIONED CONTRACT
 */

import type { ScoringOutputV1 } from "../../../engine/contracts/scoring";
import type { ExecutiveSummary } from "../output/ExecutiveSummary";
import type { RemediationPlan } from "../output/RemediationPlan";
import type { ResultIntegrityV1 } from "../integrity/ResultIntegrity";

export interface AuditSprintResultV1 {
  meta: {
    version: "audit-sprint-result-v1";
    generatedAt: string;
    licenseTier: string;
  };

  scoring: ScoringOutputV1;

  executiveSummary?: ExecutiveSummary;
  remediationPlan?: RemediationPlan;

  entitlements: {
    executiveSummary: boolean;
    remediationPlan: boolean;
  };

  integrity: ResultIntegrityV1;
}
