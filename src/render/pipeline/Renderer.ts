import type { RenderTarget } from "../contracts/RenderTarget";
import type { RenderManifestV1 } from "../manifest/RenderManifestV1";
import type { RenderResult } from "./RenderResult";

export interface Renderer {
  readonly target: RenderTarget;
  render(manifest: RenderManifestV1): RenderResult;
}
