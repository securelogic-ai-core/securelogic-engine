import type { BackupPolicyV1 } from "./BackupPolicyV1";

export function assertBackupPolicy(p: BackupPolicyV1): void {
  if (!p.encrypted || p.frequencyMinutes <= 0 || p.retentionDays <= 0) {
    throw new Error("BACKUP_POLICY_VIOLATION");
  }
}
