import type { EngineExecutionRecord } from "securelogic-contracts";
import { synthesizeDecision } from "../decision/DecisionSynthesisEngine.js";
import { hashObject } from "../utils/hasher.js";

export interface ReplayVerificationResult {
  matches: boolean;
  expectedHash: string;
  actualHash: string;
}

export function verifyReplay(
  record: EngineExecutionRecord,
  context: any,
  findings: any[],
  policyBundle: any
): ReplayVerificationResult {
  const decision = synthesizeDecision(context, findings, policyBundle);

  const actualHash = hashObject(decision);
  const expectedHash = record.finalDecisionHash;

  return {
    matches: actualHash === expectedHash,
    expectedHash,
    actualHash
  };
}
