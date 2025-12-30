import type { LicenseTier } from "../../product/contracts/LicenseTier";
import type { OpinionEnvelope } from "../../opinion/contracts/OpinionEnvelope";
import type { RenderResult } from "../pipeline/RenderResult";

import { buildRenderManifest } from "../manifest/buildRenderManifest";
import { executeRenderPipeline } from "../pipeline/executeRenderPipeline";

export function generateArtifacts(
  opinion: OpinionEnvelope,
  license: LicenseTier
): RenderResult[] {
  const manifest = buildRenderManifest(license, opinion.severity);

  return manifest.targets.map(target =>
    executeRenderPipeline({
      version: "V1",
      target,
      license,
      payloadRef: opinion.id
    })
  );
}
