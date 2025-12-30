import type { RenderManifestV1 } from "../manifest/RenderManifestV1";

export interface RenderContext {
  manifest: RenderManifestV1;
  correlationId: string;
}
