export interface PreviewSignal {
  id: string;
  headline: string;
  summary: string;
  riskBand: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  score: number;
  preview: true;
  disclaimer: string;
}
