export interface AuditSprintReportV1 {
  version: "v1";

  assessment: {
    name: string;
    date: string;
  };

  executiveSummary: {
    overallRisk: "Low" | "Medium" | "High";
    enterpriseRiskScore: number;
    approvalStatus: "Approved" | "Conditional" | "Rejected";
    narrative: string;
  };

  enterpriseOverview: {
    totalRiskScore: number;
    severity: "Low" | "Medium" | "High";
    topRiskDomains: string[];
  };

  materialRisks: Array<{
    id: string;
    title: string;
    severity: "Low" | "Medium" | "High";
    contributionPercent: number;
    whyItMatters: string;
  }>;

  controlGaps: Array<{
    controlId: string;
    domain: string;
    issue: string;
  }>;

  recommendedActions: Array<{
    action: string;
    priority: "Immediate" | "Near-term" | "Strategic";
    riskAddressed: string;
  }>;

  disclaimers: string[];
}
