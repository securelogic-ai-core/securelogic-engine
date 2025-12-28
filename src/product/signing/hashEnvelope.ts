import type { ResultEnvelope } from "../contracts";
import { canonicalize } from "../integrity/canonicalize";
import { createHash } from "crypto";

export function hashEnvelope(envelope: ResultEnvelope): string {
  return createHash("sha256")
    .update(
      canonicalize({
        version: envelope.version,
        payloadHash: hashObject(envelope.payload),
      })
    )
    .digest("hex");
}
