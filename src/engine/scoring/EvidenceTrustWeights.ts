import type { EvidenceTrustLevel } from "../../reporting/ReportSchema.js";

export const EVIDENCE_TRUST_WEIGHTS: Record<EvidenceTrustLevel, number> = {
  SelfAttested: 0.3,
  Internal: 0.6,
  System: 0.85,
  Independent: 1.0
};
