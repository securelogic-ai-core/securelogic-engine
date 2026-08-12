/**
 * portalUploadPolicy.ts — pure, I/O-free limits for EXTERNAL vendor uploads and
 * comments. No DB, no storage, no Express.
 *
 * ── Why a per-ENGAGEMENT quota exists on top of the per-org one ───────────────
 * `evidence.ts` already enforces MAX_ORG_EVIDENCE_STORAGE_BYTES (2 GiB). That cap
 * is sufficient against an internal user, because an internal user filling it
 * only harms their own organisation and is identifiable.
 *
 * It is NOT sufficient here. An org-wide cap is a SHARED resource, and the vendor
 * portal lets a third party consume it. A single hostile — or merely careless —
 * vendor could upload 2 GiB and thereby stop the customer's own staff from
 * attaching evidence anywhere in the product. That is a denial of service against
 * the paying customer, executed through a surface we opened on their behalf.
 *
 * So the engagement budget is checked FIRST and is small enough that exhausting
 * it costs the org nothing. The org cap still applies underneath as a backstop.
 *
 * ── Why the file limit is not simply MAX_EVIDENCE_FILE_BYTES ──────────────────
 * It is currently the same number, deliberately re-exported rather than
 * re-declared so the two cannot silently diverge. It has its own name because the
 * external limit is a different decision from the internal one and will
 * eventually move independently — lowering the external one must not require
 * touching the internal one.
 *
 * File CONTENT validation (allowlist, magic bytes, NUL sniffing, filename
 * sanitisation) is NOT duplicated here. `evidenceFileValidation.ts` is the single
 * authority and the portal calls it directly; a second allowlist would be a
 * second source of truth that drifts.
 */

import { MAX_EVIDENCE_FILE_BYTES } from "../evidenceFileValidation.js";

/** Largest single file an external vendor may upload. */
export const MAX_PORTAL_FILE_BYTES = MAX_EVIDENCE_FILE_BYTES;

/**
 * Total bytes one engagement may hold. 250 MiB is roughly ten full SOC 2 reports
 * with appendices — comfortably beyond a real questionnaire, far below anything
 * that inconveniences the org.
 */
export const MAX_PORTAL_ENGAGEMENT_BYTES = 250 * 1024 * 1024;

/**
 * Total files one engagement may hold. A byte budget alone does not stop 50,000
 * one-byte files, which costs storage almost nothing and costs the reviewer's
 * attention — and the analysis worker's queue — a great deal.
 */
export const MAX_PORTAL_ENGAGEMENT_FILES = 100;

/** Longest comment body. Generous for prose, bounded against a payload dump. */
export const MAX_PORTAL_COMMENT_CHARS = 8000;

/** Comments one engagement may hold, both sides combined. */
export const MAX_PORTAL_ENGAGEMENT_COMMENTS = 500;

export type QuotaDecision =
  | { ok: true }
  | {
      ok: false;
      error: "engagement_storage_quota_exceeded" | "engagement_file_count_exceeded";
      limit: number;
      used: number;
      message: string;
    };

/**
 * Decide whether one more file of `incomingBytes` fits.
 *
 * `usedBytes` / `usedFiles` are the CURRENT persisted totals for the engagement.
 * The caller must read them inside the same transaction as the insert; this
 * function cannot close a race it never sees.
 */
export function checkEngagementQuota(args: {
  usedBytes: number;
  usedFiles: number;
  incomingBytes: number;
}): QuotaDecision {
  if (args.usedFiles + 1 > MAX_PORTAL_ENGAGEMENT_FILES) {
    return {
      ok: false,
      error: "engagement_file_count_exceeded",
      limit: MAX_PORTAL_ENGAGEMENT_FILES,
      used: args.usedFiles,
      message: `This request already has the maximum of ${MAX_PORTAL_ENGAGEMENT_FILES} attachments. Please remove one, or combine documents.`,
    };
  }
  if (args.usedBytes + args.incomingBytes > MAX_PORTAL_ENGAGEMENT_BYTES) {
    return {
      ok: false,
      error: "engagement_storage_quota_exceeded",
      limit: MAX_PORTAL_ENGAGEMENT_BYTES,
      used: args.usedBytes,
      message: `This request has reached its ${Math.floor(
        MAX_PORTAL_ENGAGEMENT_BYTES / (1024 * 1024)
      )} MB attachment limit. Please remove a file before adding another.`,
    };
  }
  return { ok: true };
}

export type CommentDecision =
  | { ok: true; body: string }
  | { ok: false; error: "comment_empty" | "comment_too_long" | "comment_limit_reached"; message: string };

/**
 * Validate a comment body and the engagement's comment budget.
 *
 * The body is trimmed but otherwise stored verbatim — NOT HTML-escaped and NOT
 * stripped. Escaping at write time destroys the original text and produces
 * double-escaping the moment a second renderer appears; the correct boundary is
 * the renderer, and every consumer of this field renders as text. It is also fed
 * to an LLM downstream, which is precisely why it must be stored exactly as
 * written: the analysis layer needs to see a prompt-injection attempt in order to
 * be evaluated against one.
 */
export function validateComment(args: {
  body: unknown;
  existingCount: number;
}): CommentDecision {
  if (args.existingCount >= MAX_PORTAL_ENGAGEMENT_COMMENTS) {
    return {
      ok: false,
      error: "comment_limit_reached",
      message: "This conversation has reached its message limit. Please contact your reviewer directly.",
    };
  }
  const raw = typeof args.body === "string" ? args.body.trim() : "";
  if (raw.length === 0) {
    return { ok: false, error: "comment_empty", message: "Enter a message before sending." };
  }
  if (raw.length > MAX_PORTAL_COMMENT_CHARS) {
    return {
      ok: false,
      error: "comment_too_long",
      message: `Messages are limited to ${MAX_PORTAL_COMMENT_CHARS.toLocaleString()} characters.`,
    };
  }
  return { ok: true, body: raw };
}
