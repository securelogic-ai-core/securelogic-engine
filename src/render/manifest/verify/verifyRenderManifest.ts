import crypto from "crypto";
import type { RenderManifestV1 } from "../RenderManifestV1";
import { getEnvelopePublicKey } from "../../_frozen_prod/signing/resultEnvelopeKey";

export function verifyRenderManifest(
  manifest: RenderManifestV1
): { status: "VALID" | "INVALID_SIGNATURE" | "INVALID_PAYLOAD" } {
  const reconstructed = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        inputs: manifest.inputs,
        targets: manifest.targets,
        policy: manifest.policy,
      })
    )
    .digest("hex");

  if (reconstructed !== manifest.payloadHash) {
    return { status: "INVALID_PAYLOAD" };
  }

  const valid = crypto.verify(
    null,
    Buffer.from(manifest.payloadHash),
    getEnvelopePublicKey(),
    Buffer.from(manifest.signature, "base64")
  );

  return valid ? { status: "VALID" } : { status: "INVALID_SIGNATURE" };
}
