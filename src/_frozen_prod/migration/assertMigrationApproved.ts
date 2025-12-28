import type { MigrationPlanV1 } from "./MigrationPlanV1";

export function assertMigrationApproved(plan: MigrationPlanV1): void {
  if (!plan.approved) {
    throw new Error("MIGRATION_NOT_APPROVED");
  }
}
