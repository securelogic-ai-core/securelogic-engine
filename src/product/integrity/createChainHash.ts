import type { AuditSprintResultV1 } from "../contracts";

/**
 * Phase 3: deterministic chain hash
 * Phase 4 will harden this with cryptographic hashing
 */
export function createChainHash(
  result: AuditSprintResultV1,
  parentHash?: string
): string {
  const payload = JSON.stringify(result);
  return parentHash ? `${parentHash}::${payload}` : payload;
}
