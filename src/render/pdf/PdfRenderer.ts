import type { Renderer } from "../pipeline/Renderer";
import type { RenderManifestV1 } from "../manifest/RenderManifestV1";
import type { RenderResult } from "../pipeline/RenderResult";
import crypto from "crypto";

export class PdfRenderer implements Renderer {
  readonly target = "PDF" as const;

  render(_: RenderManifestV1): RenderResult {
    const artifactId = crypto.randomUUID();

    return {
      target: "PDF",
      artifactType: "PDF",
      artifactRef: `pdf://${artifactId}`,
      generatedAt: new Date().toISOString()
    };
  }
}
