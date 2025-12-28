import type { PolicyRuleV1 } from "./PolicyRuleV1";
import type { PolicyContextV1 } from "./PolicyContextV1";

export function evaluatePolicy(
  rules: PolicyRuleV1[],
  context: PolicyContextV1
): { decision: "ALLOW" | "DENY"; violatedRule?: string } {
  for (const rule of rules) {
    if (rule.condition(context)) {
      if (rule.effect === "DENY") {
        return { decision: "DENY", violatedRule: rule.id };
      }
    }
  }
  return { decision: "ALLOW" };
}
