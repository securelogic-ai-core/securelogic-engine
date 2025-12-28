export interface ResultEvidenceV1 {
  evidenceId: string;
  type: "file" | "url" | "hash";
  locator: string;
  sha256?: string;
}
