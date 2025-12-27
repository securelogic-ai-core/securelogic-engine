import type { ResultEnvelope } from "../contracts";
import { canonicalize } from "./canonicalize";
import { createHash } from "crypto";
import { verifyResultSignature } from "../signing/verifyResultSignature";
import { DEFAULT_QUORUM } from "../signing/defaultQuorum";

export function verifyResultEnvelope(envelope: ResultEnvelope): boolean {
  const data =
    (envelope as unknown as { payload?: unknown }).payload ??
    envelope.result;

  const expectedPayloadHash = createHash("sha256")
    .update(canonicalize(data))
    .digest("hex");

  if (envelope.payloadHash !== expectedPayloadHash) return false;

  const signatures = envelope.signatures ?? [];
  let valid = 0;

  for (const sig of signatures) {
    if (!verifyResultSignature(envelope, sig)) return false;
    valid++;
  }

  return valid >= DEFAULT_QUORUM.minimumSignatures;
}
