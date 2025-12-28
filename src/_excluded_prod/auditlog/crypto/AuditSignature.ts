export interface AuditSignature {
  algorithm: "ed25519";
  publicKeyId: string;
  signature: string;
}
