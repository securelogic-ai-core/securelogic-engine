import type { TrustStore, TrustedKey } from "../TrustStore.js";

export class InMemoryTrustStore implements TrustStore {
  private keys = new Map<string, TrustedKey>();

  async addKey(key: TrustedKey): Promise<void> {
    this.keys.set(key.keyId, key);
  }

  async getKey(keyId: string): Promise<TrustedKey | null> {
    return this.keys.get(keyId) ?? null;
  }
}
