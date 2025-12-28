export interface TrustLevelV1 {
  version: "trust-level-v1";
  subjectId: string;
  level: number; // 0–100
  issuedAt: string;
  issuedBy: string;
}
