import { randomUUID } from "crypto";

export type ExecutionStage = {
  name: string;
  input: unknown;
  output: unknown;
};

export type ExecutionRun = {
  runId: string;
  engineVersion: string;
  policyHash: string;
  stages: ExecutionStage[];
  finalOutput: unknown;
};

export class ExecutionPipeline {
  private stages: ExecutionStage[] = [];

  constructor(
    private engineVersion: string,
    private policyHash: string
  ) {}

  addStage(name: string, input: unknown, output: unknown) {
    this.stages.push({ name, input, output });
  }

  build(finalOutput: unknown): ExecutionRun {
    return {
      runId: randomUUID(),
      engineVersion: this.engineVersion,
      policyHash: this.policyHash,
      stages: this.stages,
      finalOutput
    };
  }
}
