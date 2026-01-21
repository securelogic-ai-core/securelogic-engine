import type { AuditSprintReport, RiskLevel, Finding } from "./ReportSchema.js";
import type { EngineInput } from "../engine/RunnerEngine.js";

import { DomainRiskAggregationEngine } from "../engine/scoring/DomainRiskAggregationEngine.js";

export class ReportBuilder {
  static build(
    client: {
      name: string;
      industry: string;
      assessmentType: string;
      scope: string;
    },
    input: EngineInput,
    result: { severity: RiskLevel },
    ledgerHash: string,
    findings: Finding[]
  ): AuditSprintReport {

    const domainProfiles = DomainRiskAggregationEngine.aggregate(
      findings,
      input.context
    );

    const overallRisk: RiskLevel = result.severity;

    return {
      meta: {
        clientName: client.name,
        industry: client.industry,
        assessmentType: client.assessmentType,
        scope: client.scope,
        generatedAt: new Date().toISOString(),
        ledgerHash
      },
      executiveSummary: {
        overallRisk,
        narrative: "This assessment provides an initial view of the organization's AI governance posture and risk exposure."
      },
      domainScores: domainProfiles.map(d => ({
        domain: d.domain,
        rating: d.severity,
        notes: `${d.findingCount} finding(s), score ${d.finalScore} (base ${d.baseScore}, x${(1 + d.contextFactor).toFixed(2)})`
      })),
      findings
    };
  }
}
