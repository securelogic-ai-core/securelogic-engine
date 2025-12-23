/**
 * Result Integrity Metadata — V1
 *
 * ENTERPRISE AUDIT CONTRACT
 */
export interface ResultIntegrityV1 {
  algorithm: "sha256";
  hash: string;
  generatedAt: string;
  canonicalVersion: "v1";
}
