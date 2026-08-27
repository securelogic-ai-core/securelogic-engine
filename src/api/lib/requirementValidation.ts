/**
 * requirementValidation.ts — Pure validation for requirement routes.
 *
 * No I/O. Returns a discriminated union: { input } | { error, detail? }.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// validateRequirementCreate
// ---------------------------------------------------------------------------

/** Guidance is rendered to EXTERNAL vendors in the portal questionnaire, so it
 *  gets a hard cap — a paragraph, not a document. */
const MAX_DESCRIPTION_LENGTH = 4000;

export type RequirementCreateInput = {
  framework_id: string;
  reference_id: string;
  title: string;
  description: string | null;
};

export type RequirementCreateResult =
  | { input: RequirementCreateInput }
  | { error: string; detail?: string };

export function validateRequirementCreate(
  body: unknown
): RequirementCreateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // framework_id — required UUID
  if (!isNonEmptyString(b["framework_id"])) {
    return { error: "framework_id_required" };
  }
  if (!isUuid(b["framework_id"])) {
    return { error: "framework_id_must_be_uuid" };
  }
  const framework_id = b["framework_id"] as string;

  // reference_id — required non-empty string (e.g. "ID.AM-1")
  if (!isNonEmptyString(b["reference_id"])) {
    return { error: "reference_id_required" };
  }
  const reference_id = (b["reference_id"] as string).trim();

  // title — required non-empty string
  if (!isNonEmptyString(b["title"])) {
    return { error: "title_required" };
  }
  const title = (b["title"] as string).trim();

  // description — optional guidance text (VA-6). Shown to external vendors as
  // "guidance" in the portal questionnaire, so it is length-capped.
  let description: string | null = null;
  if (b["description"] !== undefined && b["description"] !== null) {
    if (typeof b["description"] !== "string") {
      return { error: "description_must_be_string" };
    }
    const trimmed = (b["description"] as string).trim();
    if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
      return {
        error: "description_too_long",
        detail: `Guidance is capped at ${MAX_DESCRIPTION_LENGTH} characters.`,
      };
    }
    description = trimmed.length > 0 ? trimmed : null;
  }

  return { input: { framework_id, reference_id, title, description } };
}

// ---------------------------------------------------------------------------
// validateRequirementCurationPatch — VA-6.
//
// Curation may change the CONTENT of a question (guidance, scope tags), never
// its IDENTITY (reference_id, title): responses and scope items reference the
// requirement, and a renamed question would silently rewrite what a vendor
// already answered. Scope-tag membership is validated against the closed
// vocabulary by the route (areValidScopeTags), not here — this layer only
// checks shape.
// ---------------------------------------------------------------------------

export type RequirementCurationPatchInput = {
  description?: string | null;
  scope_tags?: string[];
};

export type RequirementCurationPatchResult =
  | { input: RequirementCurationPatchInput }
  | { error: string; detail?: string };

export function validateRequirementCurationPatch(
  body: unknown
): RequirementCurationPatchResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;
  const input: RequirementCurationPatchInput = {};

  if ("description" in b) {
    if (b["description"] === null) {
      input.description = null;
    } else if (typeof b["description"] !== "string") {
      return { error: "description_must_be_string" };
    } else {
      const trimmed = (b["description"] as string).trim();
      if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
        return {
          error: "description_too_long",
          detail: `Guidance is capped at ${MAX_DESCRIPTION_LENGTH} characters.`,
        };
      }
      input.description = trimmed.length > 0 ? trimmed : null;
    }
  }

  if ("scope_tags" in b) {
    if (
      !Array.isArray(b["scope_tags"]) ||
      b["scope_tags"].some((t) => typeof t !== "string")
    ) {
      return { error: "scope_tags_must_be_string_array" };
    }
    // Dedupe + sort so the stored array is canonical regardless of input order.
    input.scope_tags = Array.from(
      new Set((b["scope_tags"] as string[]).map((t) => t.trim()).filter(Boolean))
    ).sort();
  }

  if (input.description === undefined && input.scope_tags === undefined) {
    return {
      error: "nothing_to_update",
      detail: "Provide description and/or scope_tags.",
    };
  }

  return { input };
}
