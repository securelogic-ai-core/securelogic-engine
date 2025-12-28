export function assertRateLimit(
  count: number,
  limit: number
): void {
  if (count > limit) {
    throw new Error("RATE_LIMIT_EXCEEDED");
  }
}
