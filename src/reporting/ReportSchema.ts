export type RiskLevel = "Low" | "Moderate" | "High" | "Critical";

export type Finding = {
  framework: string;
  id: string;
  title: string;
  severity: RiskLevel;
  domain: string;
  businessImpact: string;
  evidence: string;
  recommendation: string;
};

export type DomainScore = {
  domain: string;
  rating: RiskLevel;
  notes: string;
};

export type AuditSprintReport = {
  meta: {
    clientName: string;
    industry: string;
    assessmentType: string;
    scope: string;
    generatedAt: string;
    ledgerHash: string;
  };
  executiveSummary: {
    overallRisk: RiskLevel;
    narrative: string;
  };
  domainScores: DomainScore[];
  findings: Finding[];
};
