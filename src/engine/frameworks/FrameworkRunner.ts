import type { EngineInput } from "../RunnerEngine.js";
import type { Finding } from "../../reporting/ReportSchema.js";

export type FrameworkResult = {
  framework: string;
  findings: Finding[];
};

export interface FrameworkRunner {
  name: string;
  run(input: EngineInput): Promise<FrameworkResult>;
}
