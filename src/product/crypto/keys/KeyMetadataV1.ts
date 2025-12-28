export interface KeyMetadataV1 {
  keyId: string;
  algorithm: "ed25519";
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
}
