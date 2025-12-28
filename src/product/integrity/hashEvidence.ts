import type { ResultEvidenceV1 } from "../contracts";
import crypto from "crypto";

export function hashEvidence(evidence: ResultEvidenceV1[]): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(evidence))
    .digest("hex");
}
