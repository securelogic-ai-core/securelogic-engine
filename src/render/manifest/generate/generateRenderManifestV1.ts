import crypto from "crypto";
import type { RenderManifestV1 } from "../RenderManifestV1";
import type { RenderTarget } from "../RenderTarget";

export interface GenerateRenderManifestInput {
  source: {
    type: "AUDIT_RESULT" | "OPINION";
    referenceId: string;
  };
  targets: RenderTarget[];
  requestedBy: string;
}

export function generateRenderManifestV1(
  input: GenerateRenderManifestInput
): RenderManifestV1 {
  const unsigned = {
    kind: "RenderManifest",
    version: "v1",
    source: input.source,
    targets: input.targets,
    requestedBy: input.requestedBy,
    generatedAt: new Date().toISOString(),
  };

  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(unsigned))
    .digest("hex");

  return {
    ...unsigned,
    integrity: {
      hash,
      signature: "",
    },
  };
}
