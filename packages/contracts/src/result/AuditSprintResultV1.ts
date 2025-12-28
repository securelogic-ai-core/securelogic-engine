import type { ExecutiveSummary } from "../output/ExecutiveSummary.js";
import type { RemediationPlan } from "../output/RemediationPlan.js";
import type { FindingV1 } from "../finding/Finding.js";
import type { RiskRollupV1 } from "../risk/RiskRollup.js";
import type { ControlTraceV1 } from "../control/ControlTrace.js";
import type { EvidenceReferenceV1 } from "../evidence/EvidenceReference.js";
import type { EvidenceLinkV1 } from "../evidence/EvidenceLink.js";
import type { AttestationV1 } from "../attestation/Attestation.js";
import type { ExecutionContextV1 } from "../context/ExecutionContext.js";
import type { ResultIntegrityV1 } from "../integrity/ResultIntegrity.js";

export interface AuditSprintResultV1 {
  version: "audit-sprint-result-v1";
  context: ExecutionContextV1;
  summary: ExecutiveSummary;
  remediation: RemediationPlan;
  findings: FindingV1[];
  risk: RiskRollupV1;
  controls: ControlTraceV1[];
  evidence?: {
    references?: EvidenceReferenceV1[];
    links?: EvidenceLinkV1[];
  };
  attestations?: AttestationV1[];
  integrity?: ResultIntegrityV1;
}
