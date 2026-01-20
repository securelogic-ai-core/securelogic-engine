import { verifyLineage } from "./LineageVerifier.js";
import { synthesizeDecision } from "../decision/DecisionSynthesisEngine.js";
import type { ExecutionRecord, RiskContext, Finding } from "securelogic-contracts";

export class DeterministicReplayEngine {

  static replay(
    record: ExecutionRecord & { lineageHash: string },
    context: RiskContext,
    findings: Finding[],
    policyBundle: unknown
  ) {
    // 1) Verify lineage integrity
    const ok = verifyLineage(record);
    if (!ok) {
      throw new Error("❌ Lineage hash verification failed. Record was tampered.");
    }

    // 2) Re-run engine
    const newDecision = synthesizeDecision(context, findings, policyBundle);

    // 3) Compare results
    const same =
      JSON.stringify(newDecision) === JSON.stringify(record.finalDecision);

    if (!same) {
      throw new Error("❌ Replay result does not match original decision.");
    }

    return {
      verified: true,
      decision: newDecision
    };
  }
}
