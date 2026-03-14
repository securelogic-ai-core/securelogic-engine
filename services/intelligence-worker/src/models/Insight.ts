export type Insight = {
  id: string;
  signalId: string;
  title: string;
  analysis: string;
  recommendation: string;
  riskLevel: "low" | "medium" | "high";
  audience: string[];
  createdAt: string;
};