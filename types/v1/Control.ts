export interface CanonicalControlInput {
  id: string;
  title: string;
  description: string;
  domain: string;
  keywords: string[];
}

export interface CanonicalControl {
  canonicalId: string;
  canonicalTitle: string;
  canonicalDescription: string;
  canonicalDomain: string;
  canonicalKeywords: string[];
  frameworkIds: string[];
  baselineImpact: number;
  baselineLikelihood: number;
}
