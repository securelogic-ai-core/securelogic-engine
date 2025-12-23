/**
 * SecureLogic Engine
 * ==================
 * Scoring Output Contract — V1
 *
 * ENTERPRISE, CLIENT-FACING, VERSIONED CONTRACT
 */

export type RiskScoreValue = number; // 0–100 inclusive

export interface DomainScore {
  domain: string;
  score: RiskScoreValue;
}

export interface ScoringOutputV1 {
  version: "scoring-output-v1";
  overallRiskScore: RiskScoreValue;
  domainScores?: DomainScore[];
  orgProfile: {
    industry: string;
    size: "SMB" | "Mid-Market" | "Enterprise";
  };
  generatedAt: string;
}
