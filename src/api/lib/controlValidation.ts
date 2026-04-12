/**
 * controlValidation.ts — Pure validation for control routes.
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
// validateControlCreate
// ---------------------------------------------------------------------------

export type ControlCreateInput = {
  name: string;
  description: string | null;
  owner_user_id: string | null;
};

export type ControlCreateResult =
  | { input: ControlCreateInput }
  | { error: string; detail?: string };

export function validateControlCreate(body: unknown): ControlCreateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // name — required non-empty string
  if (!isNonEmptyString(b["name"])) {
    return { error: "name_required" };
  }
  const name = (b["name"] as string).trim();

  // description — optional string or null
  let description: string | null = null;
  if ("description" in b) {
    if (b["description"] !== null && typeof b["description"] !== "string") {
      return { error: "description_must_be_string_or_null" };
    }
    description =
      typeof b["description"] === "string" && b["description"].trim().length > 0
        ? b["description"].trim()
        : null;
  }

  // owner_user_id — optional UUID or null
  let owner_user_id: string | null = null;
  if ("owner_user_id" in b) {
    if (b["owner_user_id"] !== null && b["owner_user_id"] !== undefined) {
      if (!isUuid(b["owner_user_id"])) {
        return { error: "owner_user_id_must_be_uuid_or_null" };
      }
      owner_user_id = b["owner_user_id"] as string;
    }
  }

  return { input: { name, description, owner_user_id } };
}
