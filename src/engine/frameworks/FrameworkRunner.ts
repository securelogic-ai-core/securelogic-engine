import type { EngineInput } from "../contracts/EngineInput.js";
import type { Clock } from "../runtime/Clock.js";

export type FrameworkResult = {
  framework: string;
  findings: any[];
};

export interface FrameworkRunner {
  name: string;
  run(input: EngineInput, clock: Clock): Promise<FrameworkResult>;
}
