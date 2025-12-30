export type EvidenceType =
  | "POLICY"
  | "SCREENSHOT"
  | "LOG"
  | "REPORT"
  | "CONTRACT"
  | "OTHER";

export interface EvidenceRecordV1 {
  version: "V1";
  evidenceId: string;
  questionId: string;
  uploadedBy: string;
  uploadedAt: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  evidenceType: EvidenceType;
  storageRef: string;
}
