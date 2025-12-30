import type { IntakeEnvelopeV1 } from "./IntakeEnvelopeV1";

export function assertEnvelopeIntegrity(envelope: IntakeEnvelopeV1) {
  const evidenceIds = new Set(envelope.evidence.map(e => e.evidenceId));

  for (const answer of envelope.answers) {
    for (const ev of answer.evidenceIds) {
      if (!evidenceIds.has(ev)) {
        throw new Error(
          `EVIDENCE_REFERENCE_MISSING: ${ev} referenced by ${answer.questionId}`
        );
      }
    }
  }
}
