import type { BackupSnapshotV1 } from "./BackupSnapshotV1";

export function assertRestoreTest(
  snapshot: BackupSnapshotV1,
  restoredChecksum: string
): void {
  if (snapshot.checksum !== restoredChecksum) {
    throw new Error("BACKUP_RESTORE_VERIFICATION_FAILED");
  }
}
