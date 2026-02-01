export type Signal = {
  id: string;
  source: string;
  url: string;
  title: string;
  summary: string;
  domains: string[];
  confidence: "LOW" | "MEDIUM" | "HIGH";
  detectedAt: string;
};
