import type { PolicyDecisionV1 } from "./PolicyDecisionV1";

export interface PolicyEvaluator<TContext> {
  evaluate(context: TContext): PolicyDecisionV1;
}
