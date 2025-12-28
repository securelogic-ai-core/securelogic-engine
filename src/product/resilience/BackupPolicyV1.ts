export interface BackupPolicyV1 {
  frequencyMinutes: number;
  retentionDays: number;
  encrypted: boolean;
}
