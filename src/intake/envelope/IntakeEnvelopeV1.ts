import type { EvidenceRecordV1 } from "../evidence/EvidenceRecordV1";

export type AnswerValue =
  | "YES"
  | "NO"
  | "PARTIAL"
  | "NOT_APPLICABLE";

export interface QuestionAnswerV1 {
  questionId: string;
  answer: AnswerValue;
  confidence?: "LOW" | "MEDIUM" | "HIGH";
  notes?: string;
  evidenceIds: string[];
}

export interface IntakeEnvelopeV1 {
  version: "V1";

  envelopeId: string;
  createdAt: string;

  organization: {
    orgId: string;
    name: string;
    industry?: string;
    size?: string;
  };

  submittedBy: {
    userId: string;
    role?: string;
    email?: string;
  };

  runContext: {
    framework: "SOC2" | "NIST" | "ISO27001" | "CUSTOM";
    profile?: string;
    environment?: "PROD" | "STAGING";
  };

  answers: QuestionAnswerV1[];
  evidence: EvidenceRecordV1[];

  integrity: {
    checksumSha256: string;
  };
}
