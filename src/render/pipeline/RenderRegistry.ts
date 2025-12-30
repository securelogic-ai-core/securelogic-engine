import type { Renderer } from "./Renderer";
import type { RenderManifestV1 } from "../manifest/RenderManifestV1";
import type { RenderResult } from "./RenderResult";

const renderers: Renderer[] = [];

export function registerRenderer(renderer: Renderer) {
  renderers.push(renderer);
}

export async function executeRender(
  manifest: RenderManifestV1
): Promise<RenderResult[]> {
  const results: RenderResult[] = [];

  for (const target of manifest.targets) {
    const renderer = renderers.find(r => r.supports(target));
    if (!renderer) {
      throw new Error(`No renderer registered for target: ${target}`);
    }
    results.push(await renderer.render(manifest));
  }

  return results;
}
