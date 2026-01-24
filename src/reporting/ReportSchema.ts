export type ConfidenceLevel = "Low" | "Medium" | "High" | "Very High";
export type RiskLevel = "Low" | "Moderate" | "High" | "Critical";

/* =========================
   Evidence Trust System
========================= */

export type EvidenceTrustLevel = "SelfAttested" | "Internal" | "System" | "Independent";
export type EvidenceArtifactType = "Policy" | "Config" | "Log" | "Ticket" | "Screenshot" | "Other";
export type EvidenceReviewStatus = "Draft" | "Reviewed" | "Approved";

export type EvidenceItem = {
  source: string;

  trustLevel: EvidenceTrustLevel;
  artifactType: EvidenceArtifactType;
  reviewStatus: EvidenceReviewStatus;

  reference: string;
  note?: string;
  provider: string;

  date: string;
  coversControls: string[];
};

/* =========================
   Findings
========================= */

export type Finding = {
  id: string;
  title: string;
  severity: RiskLevel;
  domain: string;
  mappedFrameworks: string[];

  evidenceItems: EvidenceItem[];

  confidence: ConfidenceLevel;
  confidenceScore: number;
  confidenceRationale: string;

  businessImpact: string;
  evidence: string;
  recommendation: string;
};

/* =========================
   Evidence Summary
========================= */

export type EvidenceSummary = {
  totalEvidenceItems: number;
  bySource: Record<string, number>;
  averageConfidenceScore: number;
  confidenceDistribution: Record<ConfidenceLevel, number>;
  narrative: string;
};

/* =========================
   Policy Violations
========================= */

export type PolicyViolation = {
  code: string;
  severity: "Warning" | "Blocker";
  message: string;
  findingIds: string[];
};

/* =========================
   Report
========================= */

export type AuditSprintReport = {
  meta: {
    clientName: string;
    industry: string;
    assessmentType: string;
    scope: string;
    generatedAt: string;
    ledgerHash: string;
    evidenceSummary?: EvidenceSummary;
    policyViolations?: PolicyViolation[];
  };

  executiveSummary: {
    overallRisk: RiskLevel;
    narrative: string;
  };

  domainScores: {
    domain: string;
    rating: RiskLevel;
    notes: string;
  }[];

  findings: Finding[];
};
