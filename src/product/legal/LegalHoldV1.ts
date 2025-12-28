export interface LegalHoldV1 {
  holdId: string;
  tenantId: string;
  scope: "ALL" | "AUDIT" | "EVIDENCE" | "DATA";
  activatedAt: string;
  reason: string;
}
