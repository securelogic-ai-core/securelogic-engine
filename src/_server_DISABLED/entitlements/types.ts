export type EntitlementType =
  | "AUDIT_SPRINT";

export type EntitlementLevel =
  | "SINGLE_RUN"
  | "MULTI_RUN"
  | "UNLIMITED";

export type EntitlementSource =
  | "STRIPE"
  | "INVOICE"
  | "ADMIN";

export interface Entitlement {
  id: string;
  principal: string; // email or account id
  type: EntitlementType;
  level: EntitlementLevel;
  remainingRuns: number | null;
  source: EntitlementSource;
  sourceRef: string;
  issuedAt: string;
}
