export interface KeyMetadataV1 {
  version: "key-metadata-v1";
  keyId: string;
  owner: string;
  algorithm: "ed25519";
  createdAt: string;
  expiresAt?: string;
  revoked: boolean;
}
