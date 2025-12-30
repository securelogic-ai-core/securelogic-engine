import crypto from "crypto";
import { writeArtifact } from "../../run/artifacts/store/artifactStore";
import type { RenderResult } from "../pipeline/RenderResult";

export function attachRenderResult(runId: string, result: RenderResult) {
  writeArtifact({
    runId,
    artifactId: crypto.randomUUID(),
    type: result.artifactType,
    uri: result.artifactRef,
    createdAt: new Date().toISOString(),
  });
}
