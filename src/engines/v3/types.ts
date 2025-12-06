export interface Intake {
  industry?: string;
  orgSize?: number;
  regulatoryRequirements?: string[];
  signals?: {
    missingEvidence?: string[];
    missingPolicies?: string[];
    missingProcedures?: string[];
  };
}

export interface V3ControlInput {
  id: string;
  title: string;
  domain: string;
  impact: number;
  likelihood: number;
}

export interface RuleResult {
  passed: boolean;
  message: string;
  deduction?: number;
}

export interface ScoredControl {
  id: string;
  title: string;
  domain: string;
  impact: number;
  likelihood: number;
  risk: number;
  findings: RuleResult[];
}
