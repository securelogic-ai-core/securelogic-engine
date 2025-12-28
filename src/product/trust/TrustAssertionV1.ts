export interface TrustAssertionV1 {
  assertionId: string;
  tenantId: string;
  category: "SECURITY" | "COMPLIANCE" | "AVAILABILITY";
  statement: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}
