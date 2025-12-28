import type { KeyMetadataV1 } from "./KeyMetadataV1";

const registry = new Map<string, KeyMetadataV1>();

export function registerKey(meta: KeyMetadataV1): void {
  registry.set(meta.keyId, meta);
}

export function getKey(keyId: string): KeyMetadataV1 {
  const k = registry.get(keyId);
  if (!k) throw new Error("KEY_NOT_FOUND");
  if (k.revoked) throw new Error("KEY_REVOKED");
  if (new Date(k.expiresAt) <= new Date()) throw new Error("KEY_EXPIRED");
  return k;
}
