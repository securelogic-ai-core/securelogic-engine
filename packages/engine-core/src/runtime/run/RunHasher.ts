import { canonicalHash } from "../canonicalHash";
import type { ExecutionRun } from "./ExecutionRun";

export function hashRun(run: ExecutionRun): string {
  // Only hash deterministic fields
  return canonicalHash({
    runId: run.runId,
    pipelineHash: run.pipelineHash,
    finalOutputHash: run.finalOutputHash,
    recordHash: run.recordHash,
    keyId: run.keyId,
    createdAt: run.createdAt
  });
}
