import type { PolicyContextV1 } from "./PolicyContextV1";

export interface PolicyRuleV1 {
  id: string;
  description: string;
  condition: (context: PolicyContextV1) => boolean;
  effect: "ALLOW" | "DENY";
}
