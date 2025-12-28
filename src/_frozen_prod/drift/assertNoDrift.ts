import type { DriftSnapshotV1 } from "./DriftSnapshotV1";

export function assertNoDrift(
  baseline: DriftSnapshotV1,
  currentChecksum: string
): void {
  if (baseline.checksum !== currentChecksum) {
    throw new Error("ENTERPRISE_DRIFT_DETECTED");
  }
}
