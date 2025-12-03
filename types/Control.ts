export interface CatalogControl {
  canonicalId: string;
  title: string;
  description: string;
  domain: string;
  keywords: string[];
  baselineImpact: number;
  baselineLikelihood: number;
}

export interface CanonicalControl {
  canonicalId: string;
  title: string;
  description: string;
  domain: string;
  keywords: string[];
  frameworks: string[];       // e.g., ["NIST-CSF", "ISO27001", "NIST-AI-RMF"]
  baselineImpact: number;     // 1–5
  baselineLikelihood: number; // 1–5
}
