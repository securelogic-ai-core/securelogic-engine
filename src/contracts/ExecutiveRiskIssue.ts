export type ExecutiveRiskIssue = {
  issueNumber: number;
  title: string;
  executiveSummary: string;
  domains: string[];
  riskTable: {
    domain: string;
    rating: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  }[];
  confidence: "LOW" | "MEDIUM" | "HIGH";
  publishedAt: string;
};
