import type { RenderStatus } from "./RenderStatus";
import type { RenderOutput } from "./RenderOutput";

export interface RenderPipelineResult {
  status: RenderStatus;
  outputs?: RenderOutput[];
  error?: string;
}
