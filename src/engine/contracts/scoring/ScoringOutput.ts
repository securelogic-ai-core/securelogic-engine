/**
 * SecureLogic Engine
 * ==================
 * Scoring Output Contract — v1
 *
 * ENTERPRISE, CLIENT-FACING, VERSIONED CONTRACT
 *
 * This is the ONLY scoring output allowed to leave the engine.
 * Any internal refactor MUST adapt to this shape.
 *
 * Breaking changes REQUIRE a new versioned contract.
 */

export interface ScoringOutputV1 {
  version: "v1";
  overallScore: number;
  domainScores: DomainScore[];
  findings: ScoringFinding[];
  generatedAt: string;
}

export interface DomainScore {
  domain: string;
  score: number;
}

export interface ScoringFinding {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
}