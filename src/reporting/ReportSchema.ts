// src/reporting/ReportSchema.ts

export type RiskLevel = "Low" | "Moderate" | "High" | "Critical";

export type ConfidenceLevel = "Low" | "Medium" | "High";

export type EvidenceItem = {
  source: "Questionnaire" | "Interview" | "Document" | "SystemScan";
  reference?: string;
  note?: string;
};

export type Finding = {
  id: string;
  title: string;
  severity: RiskLevel;
  domain: string;

  // 🔴 MULTI-FRAMEWORK ATTRIBUTION
  mappedFrameworks: string[];

  // 🔴 AUDIT-GRADE EVIDENCE
  evidenceItems: EvidenceItem[];

  // 🔴 CONFIDENCE IN THE FINDING
  confidence: ConfidenceLevel;

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