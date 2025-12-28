import type { BackupSnapshotV1 } from "./BackupSnapshotV1";

export function assertBackupVerified(b: BackupSnapshotV1): void {
  if (!b.verified) {
    throw new Error("BACKUP_NOT_VERIFIED");
  }
}
