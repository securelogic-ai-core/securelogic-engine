import { DeterministicReplayEngine } from "../runtime/DeterministicReplayEngine.js";
import type { ExecutionRecord, RiskContext, Finding } from "securelogic-contracts";

export function replayExecution(
  record: ExecutionRecord & { lineageHash: string },
  context: RiskContext,
  findings: Finding[],
  policyBundle: unknown
) {
  return DeterministicReplayEngine.replay(
    record,
    context,
    findings,
    policyBundle
  );
}
