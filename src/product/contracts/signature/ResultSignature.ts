/**
 * Result Signature — V1
 *
 * Cryptographic signature over canonical audit result.
 * ENTERPRISE / REGULATOR CONTRACT
 */
export interface ResultSignatureV1 {
  algorithm: "rsa-sha256" | "ecdsa-sha256";
  signer: {
    name: string;
    organization: string;
    keyId: string;
  };
  signature: string; // base64
  signedAt: string;
}
