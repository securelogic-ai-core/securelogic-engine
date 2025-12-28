import type { RateLimitStateV1 } from "./RateLimitStateV1";

export function assertRateLimit(state: RateLimitStateV1): void {
  if (state.count > state.limit) {
    throw new Error("RATE_LIMIT_EXCEEDED");
  }
}
