export interface OpinionEvidenceRef {
  source: "AUDIT_RESULT" | "POLICY" | "CONTROL" | "VENDOR";
  referenceId: string;
  description?: string;
}
