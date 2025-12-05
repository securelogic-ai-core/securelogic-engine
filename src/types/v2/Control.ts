export interface RawFrameworkControl {
  id: string;
  domain: string;
  title: string;
  description: string;
  keywords?: string[];
  triggerTags?: string[];
  baselineImpact?: number;
  baselineLikelihood?: number;
}

export interface CanonicalControl {
  canonicalId: string;
  canonicalDomain: string;
  canonicalTitle: string;
  canonicalDescription: string;
  canonicalKeywords: string[];
  baselineImpact: number;       // <-- added
  baselineLikelihood: number;   // <-- added
}
