import type { RiskContext, RiskDecision, EngineExecutionRecord } from "securelogic-contracts";
import { ExecutionLedger } from "./ExecutionLedger.js";
import { PhaseRunner } from "./PhaseRunner.js";

export class EngineRuntime {
  private readonly ledger = new ExecutionLedger();
  private readonly phases = new PhaseRunner();

  async execute(context: RiskContext, policyBundle: unknown): Promise<EngineExecutionRecord> {
    this.ledger.begin(context);
    this.ledger.setPolicyBundle(policyBundle);

    const decision: RiskDecision = await this.phases.runAll(context, this.ledger);

    this.ledger.finalize(decision);

    return this.ledger.build();
  }
}
