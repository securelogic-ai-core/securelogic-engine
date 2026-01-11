import { snapshotDefaultPolicySet } from "../policy/snapshotDefaultPolicySet.js";
import { synthesizeDecision } from "../decision/DecisionSynthesisEngine.js";
import { replayDecision as _replayDecision } from "../decision/DecisionReplayEngine.js";

import type { RiskContext } from "../context/RiskContext.js";
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
    policyBundle: any
  ) {
    return synthesizeDecision(context, findings, policyBundle);
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
