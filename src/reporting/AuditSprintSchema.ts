export type RiskLevel = "Low" | "Moderate" | "High" | "Critical";

export type AuditSprintInput = {
  company: {
    name: string;
    industry: string;
    size: string;
  };
  aiUsage: {
    systems: string[];
    dataTypes: string[];
    purposes: string[];
  };
  findings: {
    id: string;
    severity: RiskLevel;
    description: string;
  }[];
};

export type AuditSprintReport = {
  meta: {
    companyName: string;
    generatedAt: string;
    overallRisk: RiskLevel;
  };
  summary: {
    narrative: string;
  };
  findings: {
    id: string;
    severity: RiskLevel;
    description: string;
    recommendation: string;
  }[];
  roadmap: {
    priority: RiskLevel;
    action: string;
  }[];
};
