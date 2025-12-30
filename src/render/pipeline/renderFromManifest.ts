import type { RenderManifestV1 } from "../manifest/RenderManifestV1";
import type { Renderer } from "./Renderer";
import type { RenderResponse } from "./RenderResponse";
import { verifyOpinionEnvelope } from "../../opinion/verify/verifyOpinionEnvelope";

const registry: Record<string, Renderer> = {};

export function registerRenderer(renderer: Renderer) {
  registry[renderer.target] = renderer;
}

export async function renderFromManifest(
  manifest: RenderManifestV1
): Promise<RenderResponse> {
  if (manifest.kind !== "RenderManifest" || manifest.version !== "v1") {
    return {
      status: "FAILED",
      error: { code: "INVALID_MANIFEST", message: "Invalid render manifest" }
    };
  }

  const ctx = {
    manifest,
    correlationId: crypto.randomUUID()
  };

  const results = [];

  for (const target of manifest.targets) {
    const renderer = registry[target];
    if (!renderer) {
      return {
        status: "FAILED",
        error: {
          code: "RENDER_FAILED",
          message: `No renderer registered for ${target}`
        }
      };
    }

    results.push(await renderer.render(ctx));
  }

  return { status: "SUCCESS", results };
}
