import type { AuditSprintResultV1 } from "../contracts/result";
import type { ResultMigration } from "./ResultMigration";
import { RESULT_VERSIONS } from "./ResultVersion";

/**
 * Identity migration — V1 → V1
 * Used for validation & replay
 */
export const migrateV1ToV1: ResultMigration<
  AuditSprintResultV1,
  AuditSprintResultV1
> = {
  fromVersion: RESULT_VERSIONS.V1,
  toVersion: RESULT_VERSIONS.V1,

  migrate(input) {
    return structuredClone(input);
  }
};
