export interface Signal {
  id: string;
  title: string;
  source: string;
  category: string;
  categories?: string[];
  categoryReason?: string;
  summary: string;
  rawContent: string;
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
