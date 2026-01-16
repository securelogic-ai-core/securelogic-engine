import { DeterministicReplayEngine } from "../runtime/DeterministicReplayEngine.js";
import type { EngineExecutionRecord, RiskContext, Finding } from "securelogic-contracts";

export function replayExecution(
  record: EngineExecutionRecord & { lineageHash: string },
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
