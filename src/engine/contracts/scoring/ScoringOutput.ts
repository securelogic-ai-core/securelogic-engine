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
 * Breaking changes REQUIRE a new version file.
 */

import { RiskSeverity } from "../RiskSeverity";

/**
 * Individual scored finding mapped to a control or risk driver.
 * This is intentionally normalized and presentation-agnostic.
 */
export interface ScoringFinding {
  id: string;                 // Stable identifier (controlId or derived risk id)
  domain: string;             // Governance, Data, Model, Security, etc.
  severity: RiskSeverity;     // Canonical severity enum
  score: number;              // 0–100 normalized impact score
  rationale: string[];        // Machine + human-readable explanation
}

/**
 * Domain-level aggregation.
 * Used for dashboards, pricing, and executive summaries.
 */
export interface DomainScore {
  domain: string;
  score: number;              // 0–100
  severity: RiskSeverity;
}

/**
 * Primary scoring output returned by the engine.
 * This object is SAFE to sell, store, cache, and version.
 */
export interface ScoringOutputV1 {
  version: "v1";

  generatedAt: string;        // ISO timestamp
  engineVersion: string;      // SecureLogic engine version

  overallScore: number;       // 0–100
  overallSeverity: RiskSeverity;

  domains: DomainScore[];
  findings: ScoringFinding[];

  metadata: {
    organizationSize?: string;
    industry?: string;
    assessmentType: "audit-sprint" | "continuous" | "custom";
  };
}
