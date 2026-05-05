/**
 * signalMatchSuggestionValidation.ts — Pure validation for signal_match_suggestions
 * accept and dismiss inputs.
 *
 * No I/O. No DB access. Fully unit-testable.
 *
 * Tenant rule: organization_id is NEVER sourced from the request body. It is
 * sourced exclusively from req.organizationContext at the route layer.
 *
 * Suggestion rows themselves are not user-creatable through this lib — the
 * matcher writes them; the API only exposes accept/dismiss/list. The list
 * endpoint validates query strings inline (parseLimit + filter type-checks)
 * because there is no body to validate.
 */

import { sanitizeString } from "./sanitize.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_NOTE = 500;
const MAX_DISMISSAL_REASON = 500;

export const TARGET_TYPES = ["vendor", "ai_system", "control", "obligation"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export type AcceptInput = {
  /** Optional note carried onto the resulting link row. */
  note: string | null;
};

export type DismissInput = {
  /** Optional human-readable reason for the dismissal — audit-only. */
  dismissal_reason: string | null;
};

export type AcceptResult =
  | { input: AcceptInput }
  | { error: string; detail?: string };

export type DismissResult =
  | { input: DismissInput }
  | { error: string; detail?: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

export function isTargetType(v: unknown): v is TargetType {
  return typeof v === "string" && (TARGET_TYPES as readonly string[]).includes(v);
}

/**
 * Validate the body of POST /api/signal-match-suggestions/:id/accept.
 *
 * The body is optional; an empty body is accepted and produces { note: null }.
 * Empty / whitespace-only / explicit-null bodies are all permitted — the only
 * mutable input is `note`, which becomes the link row's `note`.
 */
export function validateSignalMatchSuggestionAccept(body: unknown): AcceptResult {
  // Permit empty body — accept has no required inputs.
  if (body === undefined || body === null) {
    return { input: { note: null } };
  }
  if (!isPlainObject(body)) {
    return { error: "request_body_must_be_object" };
  }

  const b = body as Record<string, unknown>;
  let note: string | null = null;

  if ("note" in b && b.note !== null && b.note !== undefined) {
    if (typeof b.note !== "string") {
      return { error: "note_must_be_string" };
    }
    const raw = b.note.trim();
    if (raw.length > MAX_NOTE) {
      return {
        error: "note_too_long",
        detail: `note must be ${MAX_NOTE} characters or fewer`
      };
    }
    note = raw.length === 0 ? null : sanitizeString(raw, MAX_NOTE);
  }

  return { input: { note } };
}

/**
 * Validate the body of POST /api/signal-match-suggestions/:id/dismiss.
 *
 * dismissal_reason is optional; same body-shape rules as accept.
 */
export function validateSignalMatchSuggestionDismiss(body: unknown): DismissResult {
  if (body === undefined || body === null) {
    return { input: { dismissal_reason: null } };
  }
  if (!isPlainObject(body)) {
    return { error: "request_body_must_be_object" };
  }

  const b = body as Record<string, unknown>;
  let reason: string | null = null;

  if (
    "dismissal_reason" in b &&
    b.dismissal_reason !== null &&
    b.dismissal_reason !== undefined
  ) {
    if (typeof b.dismissal_reason !== "string") {
      return { error: "dismissal_reason_must_be_string" };
    }
    const raw = b.dismissal_reason.trim();
    if (raw.length > MAX_DISMISSAL_REASON) {
      return {
        error: "dismissal_reason_too_long",
        detail: `dismissal_reason must be ${MAX_DISMISSAL_REASON} characters or fewer`
      };
    }
    reason = raw.length === 0 ? null : sanitizeString(raw, MAX_DISMISSAL_REASON);
  }

  return { input: { dismissal_reason: reason } };
}
