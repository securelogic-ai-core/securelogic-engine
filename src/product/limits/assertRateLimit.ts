import type { RateLimitPolicyV1 } from "./RateLimitPolicyV1";

export function assertRateLimit(
  count: number,
  policy: RateLimitPolicyV1
): void {
  if (count > policy.maxRequests) {
    throw new Error("RATE_LIMIT_EXCEEDED");
  }
}
