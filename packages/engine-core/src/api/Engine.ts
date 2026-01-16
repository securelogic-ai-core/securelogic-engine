import { snapshotDefaultPolicySet } from "../policy/snapshotDefaultPolicySet.js";
import { synthesizeDecision } from "../decision/DecisionSynthesisEngine.js";
import { replayDecision as _replayDecision } from "../decision/DecisionReplayEngine.js";

import { ExecutionLedger } from "../runtime/ExecutionLedger.js";

import type { RiskContext, EngineExecutionRecord } from "securelogic-contracts";
import type { Finding } from "../findings/Finding.js";

/**
 * Public Engine API
 * This is the ONLY supported entry point for consumers.
 */
export class SecureLogicEngine {

  /**
   * Snapshot current policy set into a versioned, hashed bundle
   */
  static snapshotPolicies() {
    return snapshotDefaultPolicySet();
  }

  /**
   * Run a decision deterministically from inputs
   */
  static runDecision(
    context: RiskContext,
    findings: Finding[],
    policyBundle: unknown
  ): { decision: unknown; execution: EngineExecutionRecord } {

    // Create execution ledger
    const ledger = new ExecutionLedger();

    // Bind inputs
    ledger.begin(context);
    ledger.setPolicyBundle(policyBundle);

    // Execute
    const decision = synthesizeDecision(context, findings, policyBundle, ledger);

    // Finalize ledger
    ledger.finalize(decision);

    // Produce immutable execution record
    const execution = ledger.build();

    return {
      decision,
      execution
    };
  }

  /**
   * Replay a prior decision from lineage artifacts
   */
  static replayDecision(
    policyVersionId: string,
    context: RiskContext,
    findings: Finding[]
  ) {
    return _replayDecision(policyVersionId, context, findings);
  }

  /**
   * Verify lineage integrity (stub for now)
   */
  static verifyLineage(_lineage: unknown): boolean {
    // TODO: implement cryptographic verification
    return true;
  }
}