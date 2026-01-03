import { ControlRegistry } from "../registry/ControlRegistry.js";
import type { ControlAssessment } from "../contracts/ControlAssessment.js";
import type { EngineResult, EngineFinding } from "../contracts/EngineResult.js";

export class ScoringEngineV3 {
  static score(
    assessments: ControlAssessment[]
  ): EngineResult {
    const findings: EngineFinding[] = assessments.map(assessment => {
      const definition =
        ControlRegistry.controls[assessment.controlPath];

      return {
        id: definition.id,
        title: definition.title,
        severity: assessment.satisfied ? "Low" : "High",
        likelihood: assessment.satisfied ? "Unlikely" : "Possible",
        framework: "Internal AI Risk Framework",
        rationale: `Risk derived from control ${definition.id} (${definition.title})`
      };
    });

    const overallRiskLevel =
      findings.some(f => f.severity === "Critical")
        ? "Critical"
        : findings.some(f => f.severity === "High")
        ? "High"
        : findings.some(f => f.severity === "Medium")
        ? "Medium"
        : "Low";

    return {
      overallRiskLevel,
      findings
    };
  }
}