import type { TrustAssertionV1 } from "./TrustAssertionV1";

export function exportTrustAssertions(
  assertions: TrustAssertionV1[]
): string {
  return JSON.stringify(assertions, null, 2);
}
