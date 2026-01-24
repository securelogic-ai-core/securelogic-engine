export type ExecutionRecordV1 = {
  version: "1";
  runId: string;
  pipelineHash: string;
  finalOutputHash: string;
  createdAt: string;
};
