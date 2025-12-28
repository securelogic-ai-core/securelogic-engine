import type { PolicyRule, PolicyContext, PolicyDecision } from "./PolicyRule";

export interface PolicyResult {
  decision: PolicyDecision;
  violatedRule?: string;
}

export class PolicyEngine {
  constructor(private readonly rules: PolicyRule[]) {}

  evaluate(ctx: PolicyContext): PolicyResult {
    for (const rule of this.rules) {
      const decision = rule.evaluate(ctx);
      if (decision === "DENY") {
        return { decision, violatedRule: rule.id };
      }
    }
    return { decision: "ALLOW" };
  }
}
