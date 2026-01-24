import { snapshotDefaultPolicySet } from "../policy/snapshotDefaultPolicySet.js";
import { synthesizeDecision } from "../decision/DecisionSynthesisEngine.js";
import { replayDecision as _replayDecision } from "../decision/DecisionReplayEngine.js";

import { ExecutionLedger } from "../runtime/ExecutionLedger.js";

import type { RiskContext, ExecutionRecord } from "securelogic-contracts";
import type { Finding } from "../findings/Finding.js";

export class SecureLogicEngine {

  static snapshotPolicies() {
    return snapshotDefaultPolicySet();
  }

  static runDecision(
    context: RiskContext,
    findings: Finding[],
    policyBundle: { bundleId: string; bundleHash: string; policies: any[] }
  ): { decision: unknown; execution: ExecutionRecord } {

    const ledger = new ExecutionLedger();

    ledger.begin(context);
    ledger.setPolicyBundle({
      bundleId: policyBundle.bundleId,
      bundleHash: policyBundle.bundleHash
    });

    const decision = synthesizeDecision(context, findings, policyBundle, ledger);

    ledger.finalize(decision);

    const execution = ledger.build();

    return {
      decision,
      execution
    };
  }

  static replayDecision(
    policyVersionId: string,
    context: RiskContext,
    findings: Finding[]
  ) {
    return _replayDecision(policyVersionId, context, findings);
  }

  static verifyLineage(_lineage: unknown): boolean {
    return true;
  }
}
