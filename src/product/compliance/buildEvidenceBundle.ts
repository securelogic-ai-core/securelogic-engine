import crypto from "crypto";
import type { EvidenceBundleV1 } from "./EvidenceBundleV1";
import type { AuditRecordV1 } from "../audit/AuditRecordV1";

export function buildEvidenceBundle(
  bundleId: string,
  scope: string,
  auditTrail: AuditRecordV1[]
): EvidenceBundleV1 {
  const payload = JSON.stringify({ bundleId, scope, auditTrail });
  const integrityHash = crypto
    .createHash("sha256")
    .update(payload)
    .digest("hex");

  return {
    version: "evidence-bundle-v1",
    bundleId,
    generatedAt: new Date().toISOString(),
    scope,
    auditTrail,
    integrityHash
  };
}
