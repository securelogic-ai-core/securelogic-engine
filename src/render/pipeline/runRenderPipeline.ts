import type { RenderManifestV1 } from "../manifest/RenderManifestV1";
import type { RenderPipelineResult } from "./RenderPipelineResult";

export function runRenderPipeline(
  manifest: RenderManifestV1
): RenderPipelineResult {
  return {
    status: "RENDER_ERROR",
    error: "Render pipeline not implemented"
  };
}
