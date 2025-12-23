import type { ScoringOutputV1 } from "../../../engine/contracts/scoring";
import type { ExecutiveSummary } from "../output/ExecutiveSummary";
import type { RemediationPlan } from "../output/RemediationPlan";
import type { EvidenceReferenceV1 } from "../evidence/EvidenceReference";
import type { EvidenceLinkV1 } from "../evidence/EvidenceLink";
import type { ResultIntegrityV1 } from "../integrity/ResultIntegrity";
import type { FindingV1 } from "../finding/Finding";

/**
 * Audit Sprint Result — V1
 * ENTERPRISE CLIENT OUTPUT
 */
export interface AuditSprintResultV1 {
  meta: {
    version: "audit-sprint-result-v1";
    generatedAt: string;
    licenseTier: string;
  };

  scoring: ScoringOutputV1;

  findings: FindingV1[];

  executiveSummary?: ExecutiveSummary;
  remediationPlan?: RemediationPlan;

  evidence?: {
    references: EvidenceReferenceV1[];
    links: EvidenceLinkV1[];
  };

  integrity: ResultIntegrityV1;
}
