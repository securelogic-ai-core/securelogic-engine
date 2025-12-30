import type { AuditSprintResultV1 } from "../result/AuditSprintResult.v1";

export function gateEntitlements(
  result: AuditSprintResultV1,
  requested: string[]
) {
  const licenseTier = (result.meta as any)?.licenseTier;

  if (licenseTier === "CORE" && requested.includes("write")) {
    return { allowed: false };
  }

  return { allowed: true };
}
