/**
 * Evidence Reference — V1
 *
 * ENTERPRISE AUDIT CONTRACT
 * Immutable reference to external or internal evidence.
 */
export interface EvidenceReferenceV1 {
  id: string;
  type: "document" | "screenshot" | "log" | "policy" | "attestation";
  description: string;
  hash: string;
  algorithm: "sha256";
  source: "customer" | "system" | "auditor";
  collectedAt: string;
}
