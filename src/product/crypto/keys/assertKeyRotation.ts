import { getKey } from "./KeyRegistry";

export function assertKeyRotation(keyId: string): void {
  const key = getKey(keyId);
  const ttlDays =
    (new Date(key.expiresAt).getTime() - new Date(key.createdAt).getTime()) /
    (1000 * 60 * 60 * 24);

  if (ttlDays > 90) {
    throw new Error("KEY_ROTATION_POLICY_VIOLATION");
  }
}
