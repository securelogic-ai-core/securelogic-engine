import type { BackupArtifactV1 } from "./BackupArtifactV1";

export function assertBackupIntegrity(
  backup: BackupArtifactV1,
  expectedHash: string
): void {
  if (backup.hash !== expectedHash) {
    throw new Error("BACKUP_INTEGRITY_FAILURE");
  }
}
