import type { ScoringOutputV1 } from "../../../engine/contracts/scoring";
import type { ExecutiveSummary } from "../output/ExecutiveSummary";
import type { RemediationPlan } from "../output/RemediationPlan";
import type { EvidenceReferenceV1 } from "../evidence/EvidenceReference";
import type { EvidenceLinkV1 } from "../evidence/EvidenceLink";
import type { ResultIntegrityV1 } from "../integrity/ResultIntegrity";
import type { FindingV1 } from "../finding/Finding";
import type { RiskRollupV1 } from "../risk/RiskRollup";
import type { ControlTraceV1 } from "../control/ControlTrace";
import type { ExecutionContextV1 } from "../context/ExecutionContext";
import type { AttestationV1 } from "../attestation/Attestation";
import type { ResultSignatureV1 } from "../signature/ResultSignature";

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

  executionContext: ExecutionContextV1;

  integrity: ResultIntegrityV1;
  signature?: ResultSignatureV1;

  scoring: ScoringOutputV1;
  executiveSummary?: ExecutiveSummary;
  remediationPlan?: RemediationPlan;

  findings: FindingV1[];
  riskRollup: RiskRollupV1;
  controlTraces: ControlTraceV1[];

  evidence: EvidenceReferenceV1[];
  evidenceLinks: EvidenceLinkV1[];

  attestations: AttestationV1[];
}
