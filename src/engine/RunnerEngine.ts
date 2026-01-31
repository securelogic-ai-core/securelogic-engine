import type { EngineInput } from "./contracts/EngineInput.js";
import type { RiskLevel } from "./contracts/RiskLevel.js";
import type { DecisionTraceV2 } from "./contracts/trace/DecisionTraceV2.js";

import crypto from "crypto";

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
  trace?: DecisionTraceV2;
};

const mapRiskLevelToTraceSeverity = (
  sev: RiskLevel
): "Low" | "Medium" | "High" | "Critical" => {
  if (sev === "Moderate") return "Medium";
  return sev;
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
      new NISTFramework(),
    ]);

    const frameworkResults = await orchestrator.runAll(input, this.clock);

    const rawFindings = frameworkResults.flatMap((r) => r.findings);
    const allFindings = FindingNormalizer.normalize(rawFindings);

    let decision: Decision;

    if (this.mode === "V2") {
      const domainProfiles = DomainRiskAggregationEngineV2.aggregate(
        allFindings,
        input.context
      );

      const overall = OverallRiskAggregationEngineV2.aggregate(domainProfiles);

      const flattenedDrivers = Object.values(
        overall.driversByDomain
      ).flat();

      const trace: DecisionTraceV2 = {
        version: "2.0",
        decisionId: crypto.randomUUID(),
        severity: mapRiskLevelToTraceSeverity(overall.severity),

        drivers: flattenedDrivers.map((label) => ({
          id: label,
          label,
          weight: 1,
          delta: 0,
          direction: "FLAT",
        })),

        framework: "MultiFramework",

        metadata: {
          engineVersion: "0.3.2",
          generatedAt: new Date().toISOString(),
        },
      };

      decision = process.env.SECURELOGIC_EXPLAIN
        ? {
            severity: overall.severity,
            drivers: flattenedDrivers,
            trace,
          }
        : {
            severity: overall.severity,
            drivers: flattenedDrivers,
          };
    } else {
      const domainProfiles = DomainRiskAggregationEngine.aggregate(
        allFindings,
        input.context
      );

      const overall = OverallRiskAggregationEngine.aggregate(domainProfiles);

      decision = {
        severity: overall.severity,
        drivers: overall.drivers,
      };
    }

    const ledgerHash = this.ledger.append(input, {
      decision,
      frameworks: frameworkResults.map((f) => f.framework),
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