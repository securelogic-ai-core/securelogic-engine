import { getKey } from "./KeyRegistry";

export function assertKeyRotation(keyId: string): void {
  const key = getKey(keyId);

  const ageDays =
    (Date.now() - new Date(key.createdAt).getTime()) /
    (1000 * 60 * 60 * 24);

  if (ageDays > 90) {
    throw new Error("KEY_ROTATION_REQUIRED");
  }
}
