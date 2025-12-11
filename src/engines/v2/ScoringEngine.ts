import { EngineFinding } from "../../engine/contracts/EngineResult";
import { ScoringInput } from "../../engine/contracts/ScoringInput";

export class ScoringEngine {
  static score(input: ScoringInput): EngineFinding[] {
    const findings: EngineFinding[] = [];

    // Missing AI governance
    if (!input.controls.aiGovernanceDocumented) {
      findings.push({
        id: "AI-GOV-001",
        title: "No documented AI governance framework",
        severity: "High",
        likelihood: "Likely",
        framework: "ISO 42001",
        rationale:
          "The organization has not formally documented roles, responsibilities, or oversight for AI systems."
      });
    }

    // Missing monitoring
    if (!input.controls.modelMonitoring) {
      findings.push({
        id: "AI-GOV-002",
        title: "Lack of AI model monitoring",
        severity: "Moderate",
        likelihood: "Possible",
        framework: "NIST AI RMF",
        rationale:
          "AI systems are not actively monitored for drift, bias, or anomalous behavior."
      });
    }

    return findings;
  }
}
