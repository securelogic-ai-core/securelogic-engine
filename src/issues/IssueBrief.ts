export type IssueBrief = {
  issueNumber: number;
  title: string;
  executiveSummary: string;
  domains: string[];
  riskTable: {
    domain: string;
    rating: "MODERATE" | "HIGH" | "CRITICAL";
  }[];
  confidence: "HIGH";
  publishedAt: string;
};
