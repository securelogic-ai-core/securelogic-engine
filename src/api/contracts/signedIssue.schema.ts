/**
 * Signed Issue Artifact Contract (Authoritative)
 * This is the ONLY allowed persisted issue artifact shape in production.
 *
 * SIGNATURE SCHEME (Enterprise):
 * - signature is base64(HMAC-SHA256(canonical_json(issue), SECURELOGIC_SIGNING_SECRET))
 * - canonical_json sorts keys recursively (see verifyIssueSignature.ts)
 */

import type { Issue } from "./issue.schema.js";
import { isIssue } from "./issue.schema.js";

export interface SignedIssue {
  issue: Issue;
  signature: string; // base64 HMAC-SHA256 over canonicalized issue
  signedAt: string;  // ISO-8601 timestamp
}

/**
 * Runtime contract guard
 * FAIL CLOSED
 */
export function isSignedIssue(value: unknown): value is SignedIssue {
  if (!value || typeof value !== "object") return false;

  const v = value as Record<string, unknown>;

  return (
    isIssue(v.issue) &&
    typeof v.signature === "string" &&
    v.signature.trim().length > 0 &&
    typeof v.signedAt === "string" &&
    v.signedAt.trim().length > 0
  );
}
