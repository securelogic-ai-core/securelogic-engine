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

export type RequirementCreateInput = {
  framework_id: string;
  reference_id: string;
  title: string;
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

  return { input: { framework_id, reference_id, title } };
}
