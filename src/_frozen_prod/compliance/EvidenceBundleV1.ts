import type { AuditRecordV1 } from "../audit/AuditRecordV1";

export interface EvidenceBundleV1 {
  version: "evidence-bundle-v1";
  bundleId: string;
  generatedAt: string;
  scope: string;
  auditTrail: AuditRecordV1[];
  integrityHash: string;
}
