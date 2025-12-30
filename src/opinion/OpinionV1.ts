import type { OpinionVerdict } from "./OpinionVerdict";
import type { OpinionScope } from "./OpinionScope";
import type { OpinionEvidenceRef } from "./OpinionEvidenceRef";

export interface OpinionV1 {
  kind: "SecureLogicOpinion";
  version: "v1";

  scope: OpinionScope;
  verdict: OpinionVerdict;

  issuedAt: string;
  issuedBy: "SecureLogic-AI";

  summary: string;
  rationale: string[];

  severityScore: number; // 0–100

  evidence: OpinionEvidenceRef[];

  payloadHash: string;
  signature: string;
}
