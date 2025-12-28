export interface RetentionPolicy {
  tenantId: string;
  retentionDays: number;
  legalHold?: boolean;
}
