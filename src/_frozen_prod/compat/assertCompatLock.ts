import type { CompatibilityLockV1 } from "./CompatibilityLockV1";

export function assertCompatLock(
  currentVersion: string,
  lock: CompatibilityLockV1
): void {
  if (currentVersion !== lock.lockedVersion) {
    throw new Error("COMPATIBILITY_LOCK_VIOLATION");
  }
}
