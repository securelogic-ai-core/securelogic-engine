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
import type { FrameworkResult, FrameworkRunner } from "./frameworks/FrameworkRunner.js";

import { FindingNormalizer } from "./adapters/FindingNormalizer.js";

import { DomainRiskAggregationEngine } from "./scoring/DomainRiskAggregationEngine.js";
import { OverallRiskAggregationEngine } from "./scoring/OverallRiskAggregationEngine.js";

import { DomainRiskAggregationEngineV2 } from "./scoring/v2/DomainRiskAggregationEngineV2.js";
import { OverallRiskAggregationEngineV2 } from "./scoring/v2/OverallRiskAggregationEngineV2.js";

import { ReportBuilder } from "../reporting/ReportBuilder.js";
import { ReportExporter } from "../reporting/ReportExporter.js";

import { DEFAULT_ENGINE_MODE, type EngineMode } from "./EngineMode.js";
import { type EngineLogger, noopLogger } from "./EngineLogger.js";

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
  private logger: EngineLogger;
  private frameworks: FrameworkRunner[];

  constructor(
    clock: Clock = new SystemClock(),
    mode: EngineMode = DEFAULT_ENGINE_MODE,
    logger: EngineLogger = noopLogger,
    frameworks: FrameworkRunner[] = [new AIGovFramework(), new NISTFramework()]
  ) {
    this.clock = clock;
    this.mode = mode;
    this.logger = logger;
    this.frameworks = frameworks;
  }

  async run(input: EngineInput) {
    const startedAt = Date.now();

    this.logger.info(
      { event: "engine_run_started", mode: this.mode },
      "Engine run started"
    );

    const orchestrator = new MultiFrameworkOrchestrator(
      this.frameworks,
      this.logger
    );

    let frameworkResults: FrameworkResult[];
    try {
      frameworkResults = await orchestrator.runAll(input, this.clock);
    } catch (err) {
      this.logger.error(
        {
          event: "engine_run_failed",
          mode: this.mode,
          durationMs: Date.now() - startedAt,
          err,
        },
        "Engine run failed"
      );
      throw err;
    }

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

    this.logger.info(
      {
        event: "engine_run_completed",
        mode: this.mode,
        severity: decision.severity,
        findingCount: allFindings.length,
        durationMs: Date.now() - startedAt,
      },
      "Engine run completed"
    );

    return { decision, report };
  }

  verifyLedger() {
    return this.ledger.verify();
  }
}