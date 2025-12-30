import type { Renderer } from "../pipeline/Renderer";
import type { RenderManifestV1 } from "../manifest/RenderManifestV1";
import type { RenderResult } from "../pipeline/RenderResult";

export class JsonRenderer implements Renderer {
  readonly supportsTarget = "JSON";

  render(_: RenderManifestV1): RenderResult {
    return {
      target: "JSON",
      artifactType: "JSON",
      artifactRef: "json://inline",
      generatedAt: new Date().toISOString()
    };
  }
}
