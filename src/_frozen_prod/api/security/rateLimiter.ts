const counters = new Map<string, number>();

export function assertRateLimit(consumerId: string, limit = 100) {
  const count = (counters.get(consumerId) ?? 0) + 1;
  counters.set(consumerId, count);
  if (count > limit) {
    throw new Error("RATE_LIMIT_EXCEEDED");
  }
}
