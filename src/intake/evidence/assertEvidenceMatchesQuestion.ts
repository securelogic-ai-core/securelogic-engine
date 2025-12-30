import type { QuestionV1 } from "../questions/QuestionCatalogV1";
import type { EvidenceRecordV1 } from "./EvidenceRecordV1";

export function assertEvidenceMatchesQuestion(
  question: QuestionV1,
  evidence: EvidenceRecordV1
) {
  if (!question.expectedEvidence.acceptedTypes.includes(evidence.evidenceType)) {
    throw new Error("EVIDENCE_TYPE_NOT_ALLOWED_FOR_QUESTION");
  }
}
