export type TrustedKey = {
  keyId: string;
  publicKey: string;
  status: "active" | "revoked";
  createdAt: string;
};

export interface TrustStore {
  addKey(key: TrustedKey): Promise<void>;
  getKey(keyId: string): Promise<TrustedKey | null>;
}
