export interface PolicyDecisionTrace {
  policyId: string;
  description: string;
  triggered: boolean;
  inputs: Record<string, unknown>;
  outcome?: string;
}
