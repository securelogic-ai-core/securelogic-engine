/**
 * DecisionTraceV2
 *
 * Canonical, auditable, versioned explainability trace for SecureLogic Engine.
 * This MUST be stable, deterministic, and diff-safe.
 */

export interface DecisionTraceV2 {
  version: "2.0";

  meta: {
    engineVersion: string;
    generatedAt: string; // ISO timestamp
    inputHash: string; // sha256 of normalized input
    traceId: string; // uuid
  };

  decision: {
    outcome: "ALLOW" | "DENY" | "REVIEW";
    severity: "Low" | "Medium" | "High" | "Critical";
    confidence: number; // 0..1
  };

  scores: {
    inherentRisk: number;
    residualRisk: number;
    controlEffectiveness: number;
    finalScore: number;
  };

  drivers: Array<{
    id: string;            // stable id (e.g. "NO_MFA", "NO_LOG_RETENTION")
    label: string;         // human readable
    weight: number;        // contribution weight
    delta: number;         // score impact
    direction: "UP" | "DOWN";
  }>;

  evaluations: Array<{
    controlId: string;
    controlName: string;
    framework?: string;    // e.g. "SOC2", "NIST", "ISO27001"
    passed: boolean;
    scoreImpact: number;
    evidence?: string;
    reason: string;
  }>;

  severityDerivation: {
    fromScore: number;
    toSeverity: "Low" | "Medium" | "High" | "Critical";
    rule: string; // e.g. "score >= 85 => Critical"
  };

  reasoning: {
    summary: string;          // human executive explanation
    bulletPoints: string[];   // stable ordered list
  };
}