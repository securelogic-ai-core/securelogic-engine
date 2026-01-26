import type { AuditSprintReport, RiskLevel, Finding } from "./ReportSchema.js";
import type { EngineInput } from "../engine/contracts/EngineInput.js";

import { DomainRiskAggregationEngineV2 } from "../engine/scoring/v2/DomainRiskAggregationEngineV2.js";
import { EvidenceCollector } from "../engine/adapters/EvidenceCollector.js";
import { ConfidencePolicyEnforcer } from "../engine/scoring/ConfidencePolicyEnforcer.js";

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
    // Recompute domain scores using V2 engine (canonical)
    const domainProfiles = DomainRiskAggregationEngineV2.aggregate(
      findings,
      input.context
    );

    const overallRisk: RiskLevel = result.severity;

    const evidenceSummary = EvidenceCollector.summarize(findings);

    const policyViolations = ConfidencePolicyEnforcer.evaluate(findings, {
      // set to true when you're ready to fail the run if evidence is weak
      blockOnQuestionnaireOnlyForHighRisk: true
    });

    return {
      meta: {
        clientName: client.name,
        industry: client.industry,
        assessmentType: client.assessmentType,
        scope: client.scope,
        generatedAt: new Date().toISOString(),
        ledgerHash,
        evidenceSummary,
        policyViolations
      },

      executiveSummary: {
        overallRisk,
        narrative:
          "This assessment provides an initial view of the organization's AI governance posture and risk exposure."
      },

      domainScores: domainProfiles.map(d => ({
        domain: d.domain,
        rating: d.severity,
        notes: `${d.findingCount} finding(s), score ${d.finalScore} (inherent ${d.inherentScore}, residual ${d.residualScore}, control effectiveness ${d.controlEffectiveness})`
      })),

      findings
    };
  }
}