import type { EngineInput } from "./contracts/EngineInput.js";
import type { RiskLevel } from "./contracts/RiskLevel.js";

import { ExecutionLedger } from "../runtime/ledger/ExecutionLedger.js";
import { SystemClock } from "./runtime/Clock.js";
import type { Clock } from "./runtime/Clock.js";

import { MultiFrameworkOrchestrator } from "./orchestrator/MultiFrameworkOrchestrator.js";
import { AIGovFramework } from "./frameworks/AIGovFramework.js";
import { NISTFramework } from "./frameworks/NISTFramework.js";

import { FindingNormalizer } from "./adapters/FindingNormalizer.js";

import { DomainRiskAggregationEngine } from "./scoring/DomainRiskAggregationEngine.js";
import { OverallRiskAggregationEngine } from "./scoring/OverallRiskAggregationEngine.js";

import { DomainRiskAggregationEngineV2 } from "./scoring/v2/DomainRiskAggregationEngineV2.js";
import { OverallRiskAggregationEngineV2 } from "./scoring/v2/OverallRiskAggregationEngineV2.js";

import { ReportBuilder } from "../reporting/ReportBuilder.js";
import { ReportExporter } from "../reporting/ReportExporter.js";

import { DEFAULT_ENGINE_MODE, type EngineMode } from "./EngineMode.js";

type Decision = {
  severity: RiskLevel;
  drivers: string[];
};

export class RunnerEngine {
  private ledger = new ExecutionLedger();
  private clock: Clock;
  private mode: EngineMode;

  constructor(
    clock: Clock = new SystemClock(),
    mode: EngineMode = DEFAULT_ENGINE_MODE
  ) {
    this.clock = clock;
    this.mode = mode;
  }

  async run(input: EngineInput) {
    const orchestrator = new MultiFrameworkOrchestrator([
      new AIGovFramework(),
      new NISTFramework()
    ]);

    const frameworkResults = await orchestrator.runAll(input, this.clock);

    const rawFindings = frameworkResults.flatMap(r => r.findings);
    const allFindings = FindingNormalizer.normalize(rawFindings);

    let decision: Decision;

    if (this.mode === "V2") {
      const domainProfilesV2 = DomainRiskAggregationEngineV2.aggregate(
        allFindings,
        input.context
      );

      const overallV2 = OverallRiskAggregationEngineV2.aggregate(domainProfilesV2);

      // 🔥 Flatten driversByDomain -> string[]
      const flattenedDrivers = Object.values(overallV2.driversByDomain).flat();

      decision = {
        severity: overallV2.severity,
        drivers: flattenedDrivers
      };
    } else {
      const domainProfilesV1 = DomainRiskAggregationEngine.aggregate(
        allFindings,
        input.context
      );

      const overallV1 = OverallRiskAggregationEngine.aggregate(domainProfilesV1);

      decision = {
        severity: overallV1.severity,
        drivers: overallV1.drivers
      };
    }

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