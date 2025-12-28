import { createHash } from "crypto";
import { canonicalize } from "./canonicalize";
import type { ResultIntegrityV1 } from "../contracts/integrity/ResultIntegrity";

export function hashResult(payload: unknown): ResultIntegrityV1 {
  const canonical = canonicalize(payload);
  const hash = createHash("sha256").update(canonical).digest("hex");

  return {
    algorithm: "sha256",
    hash,
    generatedAt: new Date().toISOString(),
    canonicalVersion: "v1"
  };
}
