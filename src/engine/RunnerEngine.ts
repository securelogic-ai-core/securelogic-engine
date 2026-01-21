import { ExecutionLedger } from "../runtime/ledger/ExecutionLedger.js";
import { ReportBuilder } from "../reporting/ReportBuilder.js";
import { ReportExporter } from "../reporting/ReportExporter.js";

import { DomainRiskAggregationEngine } from "./scoring/DomainRiskAggregationEngine.js";
import { OverallRiskAggregationEngine } from "./scoring/OverallRiskAggregationEngine.js";

import { MultiFrameworkOrchestrator } from "./orchestrator/MultiFrameworkOrchestrator.js";
import { AIGovFramework } from "./frameworks/AIGovFramework.js";
import { NISTFramework } from "./frameworks/NISTFramework.js";

import { FindingNormalizer } from "./adapters/FindingNormalizer.js";

export type EngineInput = {
  client: {
    name: string;
    industry: string;
    assessmentType: string;
    scope: string;
  };
  context: {
    regulated: boolean;
    safetyCritical: boolean;
    handlesPII: boolean;
    scale: "Small" | "Medium" | "Enterprise";
  };
  answers: Record<string, boolean>;
};

export class RunnerEngine {
  private ledger = new ExecutionLedger();

  async run(input: EngineInput) {
    // 1) Run all frameworks
    const orchestrator = new MultiFrameworkOrchestrator([
      new AIGovFramework(),
      new NISTFramework()
    ]);

    const frameworkResults = await orchestrator.runAll(input);

    // 2) Collect raw findings from all frameworks
    const rawFindings = frameworkResults.flatMap(r => r.findings);

    // 3) Normalize / deduplicate / merge severities & framework mappings
    const allFindings = FindingNormalizer.normalize(rawFindings);

    // 4) Aggregate domain risk
    const domainProfiles = DomainRiskAggregationEngine.aggregate(
      allFindings,
      input.context
    );

    // 5) Aggregate overall risk
    const overall = OverallRiskAggregationEngine.aggregate(domainProfiles);

    const decision = {
      severity: overall.severity,
      drivers: overall.drivers
    };

    // 6) Append to execution ledger (immutability + auditability)
    const ledgerHash = this.ledger.append(input, {
      decision,
      frameworks: frameworkResults.map(f => f.framework)
    });

    // 7) Build report from normalized findings
    const report = ReportBuilder.build(
      input.client,
      input,
      decision,
      ledgerHash,
      allFindings
    );

    // 8) Export report
    ReportExporter.exportToJson(report);

    return { decision, report };
  }

  verifyLedger() {
    return this.ledger.verify();
  }
}