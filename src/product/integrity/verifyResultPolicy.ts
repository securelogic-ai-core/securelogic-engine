import type { AuditSprintResultV1 } from "../contracts";

export function verifyResultPolicy(
  result: AuditSprintResultV1,
  consumerId?: string
): boolean {
  if (result.policy?.expiresAt) {
    if (Date.now() > Date.parse(result.policy.expiresAt)) {
      return false;
    }
  }

  if (consumerId && result.policy?.allowedConsumers) {
    return result.policy.allowedConsumers.includes(consumerId);
  }

  return true;
}
