import type { EvidenceItem } from "../../reporting/ReportSchema.js";

export class EvidenceConflictEngine {
  /**
   * Placeholder until you introduce richer evidence typing.
   * Enterprise intent: contradictions reduce confidence.
   */
  static conflictPenalty(_evidence: EvidenceItem[]): number {
    return 1.0;
  }
}
