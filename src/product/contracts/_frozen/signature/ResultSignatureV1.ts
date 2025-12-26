export interface ResultSignatureV1 {
  version: "result-signature-v1";
  keyId: string;
  algorithm: string;
  signature: string;
  signedAt: string;
}
