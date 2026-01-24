import type { EvidenceItem } from "../../reporting/ReportSchema.js";

export class EvidenceFreshnessEngine {
  /**
   * Your EvidenceItem currently has no timestamps.
   * So: neutral multiplier (1.0) until you add observedAt/capturedAt later.
   *
   * Enterprise default if no evidence: slight penalty.
   */
  static freshnessMultiplier(evidence: EvidenceItem[]): number {
    if (!evidence || evidence.length === 0) return 0.85;
    return 1.0;
  }
}
