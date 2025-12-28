import type { RetentionPolicy } from "./RetentionPolicy";

export function assertRetentionPolicy(policy: RetentionPolicy): void {
  if (policy.retentionDays <= 0) {
    throw new Error("INVALID_RETENTION_POLICY");
  }
}
