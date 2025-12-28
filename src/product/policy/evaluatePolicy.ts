import type { PolicySetV1 } from "./PolicySetV1";

export function evaluatePolicy(
  policy: PolicySetV1,
  context: any
): boolean {
  for (const rule of policy.rules) {
    if (rule.condition(context)) {
      return rule.effect === "ALLOW";
    }
  }
  return false;
}
