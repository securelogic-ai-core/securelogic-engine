import type { RenderManifestV1 } from "../manifest/RenderManifestV1";
import type { RenderResult } from "../pipeline/RenderResult";
import type { RenderReceiptV1 } from "./RenderReceiptV1";

export function generateRenderReceiptV1(
  manifest: RenderManifestV1,
  result: RenderResult
): RenderReceiptV1 {
  return {
    kind: "SecureLogicRenderReceipt",
    version: "v1",
    manifestId: manifest.id,
    artifactHash: result.artifactHash,
    artifact: result,
    issuedAt: new Date().toISOString()
  };
}
