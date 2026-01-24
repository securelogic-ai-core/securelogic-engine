export type SigningKey = {
  keyId: string;
  publicKeyPem: string;
  privateKeyPem?: string;
};

export interface KeyStore {
  getSigningKey(): Promise<SigningKey>;
  getPublicKey(keyId: string): Promise<SigningKey | null>;
}
