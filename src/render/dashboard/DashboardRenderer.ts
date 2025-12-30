import type { Renderer } from "../pipeline/Renderer";
import type { RenderManifestV1 } from "../manifest/RenderManifestV1";
import type { RenderResult } from "../pipeline/RenderResult";
import crypto from "crypto";

export class DashboardRenderer implements Renderer {
  readonly target = "DASHBOARD" as const;

  render(_: RenderManifestV1): RenderResult {
    const artifactId = crypto.randomUUID();

    return {
      target: "DASHBOARD",
      artifactType: "DASHBOARD",
      artifactRef: `dashboard://${artifactId}`,
      generatedAt: new Date().toISOString()
    };
  }
}
