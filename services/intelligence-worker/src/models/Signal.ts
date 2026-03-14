export type SignalCategory =
  | "AI_GOVERNANCE"
  | "VENDOR_RISK"
  | "SECURITY_INCIDENT"
  | "REGULATION"
  | "COMPLIANCE_UPDATE"
  | "GENERAL";

export type Signal = {
  id: string;
  title: string;
  source: string;
  category: SignalCategory;
  summary: string;
  rawContent: string;
  tags: string[];
  timestamp: string;
  processed: boolean;
};

export type ScoredSignal = Signal & {
  impactScore: number;
  noveltyScore: number;
  relevanceScore: number;
  priority: number;
};