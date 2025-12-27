import type { RiskDecision } from "../../engine/contracts/RiskDecision";
import type { RemediationDecision } from "../../engine/contracts/RiskDecision";
import type { EnterpriseRiskSummary } from "../../engine/contracts/EnterpriseRiskSummary";

export interface ExecutiveRiskReportV2Readonly {
  assessment: {
    name: string;
    date: string;
  };

  summary: EnterpriseRiskSummary;

  decision: RiskDecision;

  executiveNarrative: string;

  remediationPlan: {
    items: RemediationDecision[];
    advisoryNote: string;
  };

  pricing?: {
    tier: string;
    estimatedAnnualCost: number;
    rationale: string[];
  };
}

export type ExecutiveRiskReportV2 =
  Readonly<ExecutiveRiskReportV2Readonly>;

// NOTE:
// This schema represents a client-deliverable executive report.
// Changes require version bump (V3) and downstream review.
