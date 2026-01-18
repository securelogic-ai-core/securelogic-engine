import { canonicalHash } from "../canonicalHash.js";
import type { ExecutionRecordV1 } from "./ExecutionRecord.js";

export function buildExecutionRecordV1(
  runId: string,
  pipelineHash: string,
  finalOutputHash: string
): ExecutionRecordV1 {
  return {
    version: "1",
    runId,
    pipelineHash,
    finalOutputHash,
    createdAt: new Date().toISOString(),
  };
}

export function serializeExecutionRecord(record: ExecutionRecordV1): string {
  return JSON.stringify(record);
}

export function hashExecutionRecord(record: ExecutionRecordV1): string {
  return canonicalHash(record);
}
