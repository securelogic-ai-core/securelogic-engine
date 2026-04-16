export interface Signal {
  id: string;
  title: string;
  source: string;
  url?: string;
  category: string;
  categories?: string[];
  categoryReason?: string;
  summary: string;
  rawContent: string;
  /** CVE ID extracted from signal content, e.g. "CVE-2025-12345". Null when not found. */
  affectedCve: string | null;
  /** Known vendor/product name extracted from signal content. Null when not found. */
  affectedVendor: string | null;
  tags: string[];
  timestamp: string;
  processed: boolean;
}

export interface ScoredSignal extends Signal {
  impactScore: number;
  noveltyScore: number;
  relevanceScore: number;
  priority: number;
}
