export type QuestionAnswer = "YES" | "NO" | "PARTIAL" | "NA";

export type EvidenceRequirement = {
  required: boolean;
  acceptedTypes: readonly (
    | "POLICY"
    | "SCREENSHOT"
    | "LOG"
    | "REPORT"
    | "OTHER"
  )[];
};

export type QuestionV1 = {
  questionId: string;
  domain:
    | "ACCESS_CONTROL"
    | "CHANGE_MANAGEMENT"
    | "INCIDENT_RESPONSE"
    | "RISK_MANAGEMENT"
    | "AI_GOVERNANCE"
    | "VENDOR_MANAGEMENT"
    | "OTHER";
  text: string;
  intent: string;
  applicableFrameworks: string[];
  expectedEvidence: EvidenceRequirement;
  riskWeight: 1 | 2 | 3 | 4 | 5;
  allowedAnswers: readonly QuestionAnswer[];
};

export type QuestionCatalogV1 = {
  version: "V1";
  questions: readonly QuestionV1[];
};
