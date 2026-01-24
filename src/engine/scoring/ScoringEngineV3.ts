import type { RiskFinding } from "../contracts/RiskFinding.js";
import type { RiskLevel } from "../contracts/RiskLevel.js";
import { ControlRegistry } from "../registry/ControlRegistry.js";

const SCORE_BY_LEVEL: Record<RiskLevel, number> = {
  Low: 10,
  Moderate: 40,
  High: 70,
  Critical: 90
};

export class ScoringEngineV3 {
  static score(controlAssessments: any[]): RiskFinding[] {
    const findings: RiskFinding[] = [];

    for (const assessment of controlAssessments) {
      if (assessment.satisfied) continue;

      const definition = ControlRegistry.controls[assessment.controlPath];
      if (!definition) continue;

      // TODO: real logic later — for now default
      const level: RiskLevel = "Moderate";

      findings.push({
        domain: definition.domain,
        level,
        score: SCORE_BY_LEVEL[level],
        summary: `Control ${definition.id} not implemented`,
        evidenceCount: assessment.evidenceProvided ? 1 : 0
      });
    }

    return findings;
  }
}
