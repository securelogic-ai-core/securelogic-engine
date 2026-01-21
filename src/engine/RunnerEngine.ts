import { ExecutionLedger } from "../runtime/ledger/ExecutionLedger.js";
import { ReportBuilder } from "../reporting/ReportBuilder.js";
import { ReportExporter } from "../reporting/ReportExporter.js";

import { DomainRiskAggregationEngine } from "./scoring/DomainRiskAggregationEngine.js";
import { OverallRiskAggregationEngine } from "./scoring/OverallRiskAggregationEngine.js";

import { MultiFrameworkOrchestrator } from "./orchestrator/MultiFrameworkOrchestrator.js";
import { AIGovFramework } from "./frameworks/AIGovFramework.js";
import { NISTFramework } from "./frameworks/NISTFramework.js";

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
    const orchestrator = new MultiFrameworkOrchestrator([
      new AIGovFramework(),
      new NISTFramework()
    ]);

    const frameworkResults = await orchestrator.runAll(input);

    const allFindings = frameworkResults.flatMap(r => r.findings);

    const domainProfiles = DomainRiskAggregationEngine.aggregate(
      allFindings,
      input.context
    );

    const overall = OverallRiskAggregationEngine.aggregate(domainProfiles);

    const decision = {
      severity: overall.severity,
      drivers: overall.drivers
    };

    const ledgerHash = this.ledger.append(input, {
      decision,
      frameworks: frameworkResults.map(f => f.framework)
    });

    const report = ReportBuilder.build(
      input.client,
      input,
      decision,
      ledgerHash,
      allFindings
    );

    ReportExporter.exportToJson(report);

    return { decision, report };
  }

  verifyLedger() {
    return this.ledger.verify();
  }
}
