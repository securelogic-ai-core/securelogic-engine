import { getKey } from "./KeyRegistry";

export function revokeKey(keyId: string): void {
  const key = getKey(keyId);
  key.revoked = true;
}
