export interface PolicyRuleV1 {
  id: string;
  description: string;
  condition: (context: any) => boolean;
  effect: "ALLOW" | "DENY";
}
