export interface TrustedKey {
  keyId: string;
  algorithm: "sha256";
  activeFrom: string;
  revokedAt?: string;
}
