import type { AuditSprintResultV1 } from "../contracts/result";
import { migrateV1ToV1 } from "./v1ToV1";
import { RESULT_VERSIONS } from "./ResultVersion";

/**
 * Canonical Result Migration Engine
 */
export function migrateResult(
  result: AuditSprintResultV1
): AuditSprintResultV1 {
  switch (result.meta.version) {
    case RESULT_VERSIONS.V1:
      return migrateV1ToV1.migrate(result);

    default:
      throw new Error(
        `Unsupported result version: ${result.meta.version}`
      );
  }
}
