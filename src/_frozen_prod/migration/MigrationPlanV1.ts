export interface MigrationPlanV1 {
  fromVersion: string;
  toVersion: string;
  approved: boolean;
}
