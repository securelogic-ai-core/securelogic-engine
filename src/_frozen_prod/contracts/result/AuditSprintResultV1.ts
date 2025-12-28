/**
 * PUBLIC CONTRACT — DO NOT MODIFY IN PLACE
 * Any breaking change requires AuditSprintResultV2.ts
 */

import type { ScoringOutputV1 } from "../../../engine/contracts/scoring";
import type { ExecutiveSummary } from "../output/ExecutiveSummary";
import type { RemediationPlan } from "../output/RemediationPlan";
import type { FindingV1 } from "../finding/Finding";
import type { RiskRollupV1 } from "../risk/RiskRollup";
import type { ControlTraceV1 } from "../control/ControlTrace";
import type { EvidenceReferenceV1 } from "../evidence/EvidenceReference";
import type { EvidenceLinkV1 } from "../evidence/EvidenceLink";
import type { AttestationV1 } from "../attestation/Attestation";
import type { ExecutionContextV1 } from "../context/ExecutionContext";
import type { ResultIntegrityV1 } from "../integrity/ResultIntegrity";

/**
 * Audit Sprint Result — V1
 * =======================
 * IMMUTABLE CLIENT CONTRACT
 *
 * Breaking changes require V2.
 */
export interface AuditSprintResultV1 {
  readonly kind: "audit-sprint-result";
  readonly version: "v1";

  meta: {
    generatedAt: string;
    licenseTier: string;
  };

  executionContext: ExecutionContextV1;
  scoring: ScoringOutputV1;

  executiveSummary?: ExecutiveSummary;
  remediationPlan?: RemediationPlan;

  findings: FindingV1[];
  riskRollup: RiskRollupV1;

  controlTraces?: ControlTraceV1[];
  evidence?: EvidenceReferenceV1[];
  evidenceLinks?: EvidenceLinkV1[];
  attestations?: AttestationV1[];

  integrity: ResultIntegrityV1;
}
