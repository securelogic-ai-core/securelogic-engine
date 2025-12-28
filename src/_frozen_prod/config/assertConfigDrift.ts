import type { ConfigSnapshotV1 } from "./ConfigSnapshotV1";

export function assertConfigDrift(
  expectedHash: string,
  snapshot: ConfigSnapshotV1
): void {
  if (snapshot.hash !== expectedHash) {
    throw new Error("CONFIG_DRIFT_DETECTED");
  }
}
