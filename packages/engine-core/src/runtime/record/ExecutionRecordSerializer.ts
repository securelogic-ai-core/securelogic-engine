import type { ExecutionRun } from "../run/ExecutionPipeline.js";

export type ExecutionRecordV1 = {
  version: 1;
  run: ExecutionRun;
};

export function buildExecutionRecordV1(run: ExecutionRun): ExecutionRecordV1 {
  return {
    version: 1,
    run
  };
}

export function serializeExecutionRecord(record: ExecutionRecordV1): string {
  return JSON.stringify(record);
}
