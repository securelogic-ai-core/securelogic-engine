import type { Clock } from "../runtime/Clock.js";

export class EvidenceIngestionEngine {
  static generate(controlId: string, clock: Clock) {
    return {
      artifactType: "Other",
      coversControls: [controlId],
      date: clock.now(),
      note: "Marked as not implemented in assessment response",
      provider: "Internal",
      reference: controlId,
      reviewStatus: "Draft",
      source: "Questionnaire"
    };
  }
}
