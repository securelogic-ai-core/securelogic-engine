export interface CatalogControl {
  id: string;
  title: string;
  description: string;
  domain: string;
  keywords: string[];
}

export interface RawFrameworkControl {
  id: string;
  framework: string;
  title: string;
  description: string;
  domain: string;
  keywords: string[];
  baselineImpact?: number;
  baselineLikelihood?: number;
}

export interface CanonicalControl {
  canonicalId: string;
  canonicalTitle: string;
  canonicalDescription: string;
  canonicalDomain: string;
  canonicalKeywords: string[];
  frameworks: string[];
  baselineImpact: number;
  baselineLikelihood: number;
}
