import type { RiskContext, Decision, ExecutionRecord } from "securelogic-contracts";

export class ExecutionLedger {
  private context!: RiskContext;
  private policyBundleId!: string;
  private policyBundleHash!: string;
  private decision!: Decision;

  begin(context: RiskContext) {
    this.context = context;
  }

  setPolicyBundle(bundle: { bundleId: string; bundleHash: string }) {
    this.policyBundleId = bundle.bundleId;
    this.policyBundleHash = bundle.bundleHash;
  }

  finalize(decision: Decision) {
    this.decision = decision;
  }

  build(): ExecutionRecord {
    return {
      schemaVersion: "1.0",
      executionId: crypto.randomUUID(),
      context: this.context,
      policyBundleId: this.policyBundleId,
      policyBundleHash: this.policyBundleHash,
      decision: this.decision,
      lineage: {
        schemaVersion: "1.0",
        engineVersion: "engine-core",
        decisionId: crypto.randomUUID(),
        contextId: "context",
        policyBundleId: this.policyBundleId,
        policyBundleHash: this.policyBundleHash,
        findingsSnapshot: [],
        policyEvaluations: [],
        riskComputation: {
          method: "deterministic",
          finalRisk: this.decision.risk
        },
        aggregation: {
          rule: "default",
          finalOutcome: this.decision.outcome,
          finalRisk: this.decision.risk
        },
        createdAt: new Date().toISOString()
      },
      producedAt: new Date().toISOString(),
      engineVersion: "engine-core"
    };
  }
}
