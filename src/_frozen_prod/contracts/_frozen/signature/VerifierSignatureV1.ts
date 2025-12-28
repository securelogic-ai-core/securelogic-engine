export interface VerifierSignatureV1 {
  verifierId: string;
  algorithm: "ed25519";
  signature: string;
  signedAt: string;
}
