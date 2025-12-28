import { createHash } from "crypto";
import type { ResultEnvelope } from "../contracts";
import { canonicalize } from "./canonicalize";

export function hashEnvelope(envelope: ResultEnvelope): string {
  const canonical = canonicalize(envelope);
  return createHash("sha256").update(canonical).digest("hex");
}
