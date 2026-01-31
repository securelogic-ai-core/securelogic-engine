export interface PublicSignal {
  id: string;
  headline: string;
  riskBand: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  score: number;
  publishedAt: string;
  source: string;
}
