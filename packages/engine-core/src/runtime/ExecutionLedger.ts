import { hashObject } from "../utils/hasher.js";
import type { RiskContext, RiskDecision, EngineExecutionRecord } from "securelogic-contracts";

export class ExecutionLedger {
  private phases: any[] = [];
  private contextHash?: string;
  private policyBundleHash?: string;
  private finalDecision?: RiskDecision;

  begin(context: RiskContext) {
    this.contextHash = hashObject(context);
  }

  setPolicyBundle(bundle: unknown) {
    this.policyBundleHash = hashObject(bundle);
  }

  recordPhase(phase: { name: string; inputHash: string; outputHash: string; timestamp: string }) {
    this.phases.push(phase);
  }

  finalize(decision: RiskDecision) {
    this.finalDecision = decision;
  }

  build(): EngineExecutionRecord {
    if (!this.contextHash) throw new Error("Missing context hash");
    if (!this.policyBundleHash) throw new Error("Missing policy bundle hash");
    if (!this.finalDecision) throw new Error("Missing final decision");

    return {
      engineVersion: "0.3.2",
      policyBundleHash: this.policyBundleHash,
      inputHash: this.contextHash,
      phases: this.phases,
      finalDecision: this.finalDecision,
      finalDecisionHash: hashObject(this.finalDecision)
    };
  }
}
