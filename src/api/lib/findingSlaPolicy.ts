/**
 * findingSlaPolicy.ts — ambient-pg wrapper over findingSlaPolicyRules (20260903).
 *
 * Route handlers under asTenant() call resolveSlaDueDate and join the request
 * transaction via the ambient pg. Dispatchers/workers that hold an explicit
 * client import resolveSlaDueDateWith from findingSlaPolicyRules directly —
 * that module has NO pg import, so import-pure callers stay unit-testable.
 */

import { pg } from "../infra/postgres.js";
import { resolveSlaDueDateWith } from "./findingSlaPolicyRules.js";

export { slaDaysFor, SLA_SEVERITIES, resolveSlaDueDateWith } from "./findingSlaPolicyRules.js";

/** Resolve the SLA-defaulted due date on the ambient tenant transaction. */
export async function resolveSlaDueDate(
  organizationId: string,
  severity: string | null | undefined
): Promise<string | null> {
  return resolveSlaDueDateWith(pg, organizationId, severity);
}
