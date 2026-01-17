import crypto from "crypto";
import { canonicalize } from "json-canonicalize";

export function canonicalHash(obj: unknown): string {
  const canonical = canonicalize(obj);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}
