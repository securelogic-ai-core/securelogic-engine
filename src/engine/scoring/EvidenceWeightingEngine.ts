import type { EvidenceItem } from "../../reporting/ReportSchema.js";
import { EVIDENCE_TRUST_WEIGHTS } from "./EvidenceTrustWeights.js";

export type WeightedEvidence = EvidenceItem & {
  weight: number;
};

export class EvidenceWeightingEngine {
  static weightEvidence(evidence: EvidenceItem[]): WeightedEvidence[] {
    return evidence.map(e => {
      const trustWeight = EVIDENCE_TRUST_WEIGHTS[e.trustLevel] ?? 0.3;

      return {
        ...e,
        weight: trustWeight
      };
    });
  }

  static averageWeight(evidence: EvidenceItem[]): number {
    if (evidence.length === 0) return 0;

    const weighted = this.weightEvidence(evidence);
    const sum = weighted.reduce((acc, e) => acc + e.weight, 0);

    return sum / weighted.length;
  }
}
