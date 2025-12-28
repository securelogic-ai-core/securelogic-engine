import type { TrustAssertionV1 } from "./TrustAssertionV1";

export function assertTrustAssertion(a: TrustAssertionV1): void {
  if (new Date(a.expiresAt).getTime() <= Date.now()) {
    throw new Error("TRUST_ASSERTION_EXPIRED");
  }
}
