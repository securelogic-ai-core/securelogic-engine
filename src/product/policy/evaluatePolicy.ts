import type { PolicyV1 } from "./PolicyV1";
import type { ResultEnvelope } from "../contracts";

export function evaluatePolicy(
  policy: PolicyV1,
  envelope: ResultEnvelope,
  context: { consumerId?: string; trustLevel?: number }
): boolean {
  for (const rule of policy.rules) {
    switch (rule.type) {
      case "MAX_ATTESTATIONS":
        if (
          (envelope.attestations?.length ?? 0) >
          Number(rule.value)
        ) return false;
        break;

      case "REQUIRE_SIGNATURE":
        if ((envelope.signatures?.length ?? 0) === 0)
          return false;
        break;

      case "ALLOW_CONSUMER":
        if (context.consumerId !== rule.value) return false;
        break;

      case "DENY_CONSUMER":
        if (context.consumerId === rule.value) return false;
        break;

      case "REQUIRE_TRUST_LEVEL":
        if (
          (context.trustLevel ?? 0) <
          Number(rule.value)
        ) return false;
        break;
    }
  }
  return true;
}
