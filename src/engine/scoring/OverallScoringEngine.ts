import type { DomainScoreResult } from "./DomainScoringEngine.js";
import type { RiskLevel } from "../../reporting/ReportSchema.js";
import { EnterpriseEscalationPolicy } from "./policy/EnterpriseEscalationPolicy.js";

export class OverallScoringEngine {
  static score(domains: DomainScoreResult[]): RiskLevel {
    return EnterpriseEscalationPolicy.escalate(
      domains.map(d => d.severity)
    );
  }
}
