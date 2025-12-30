import crypto from "crypto";
import type { RenderManifestV1 } from "../RenderManifestV1";
import { getEnvelopePublicKey } from "../../_frozen_prod/signing/resultEnvelopeKey";

export type RenderManifestVerificationResult =
  | { status: "VALID" }
  | { status: "INVALID_SIGNATURE" };

export function verifyRenderManifestV1(
  manifest: RenderManifestV1
): RenderManifestVerificationResult {
  const integrity = manifest.integrity;

  // =====================================================
  // HARD GUARD — unsigned manifests are INVALID, not crypto errors
  // =====================================================
  if (!integrity?.hash || !integrity?.signature) {
    return { status: "INVALID_SIGNATURE" };
  }

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(integrity.hash);

  const publicKey = getEnvelopePublicKey();

  const isValid = verifier.verify(
    publicKey,
    integrity.signature,
    "base64"
  );

  return isValid
    ? { status: "VALID" }
    : { status: "INVALID_SIGNATURE" };
}
