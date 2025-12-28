export interface PublicKeyV1 {
  keyId: string;
  algorithm: "ed25519";
  publicKeyPem: string;
}
