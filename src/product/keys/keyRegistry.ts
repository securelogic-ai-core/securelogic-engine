import type { KeyMetadataV1 } from "./KeyMetadataV1";
import { deepFreeze } from "../integrity/deepFreeze";

const registry = new Map<string, KeyMetadataV1>();

export function registerKey(meta: KeyMetadataV1): void {
  registry.set(meta.keyId, deepFreeze(meta));
}

export function revokeKey(keyId: string): void {
  const existing = registry.get(keyId);
  if (!existing) return;
  registry.set(
    keyId,
    deepFreeze({ ...existing, revoked: true })
  );
}

export function getKey(keyId: string): KeyMetadataV1 | undefined {
  return registry.get(keyId);
}

export function listKeys(): readonly KeyMetadataV1[] {
  return [...registry.values()];
}
