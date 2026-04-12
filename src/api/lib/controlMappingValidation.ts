/**
 * controlMappingValidation.ts — Pure validation for control mapping routes.
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
// validateControlMappingCreate
// ---------------------------------------------------------------------------

export type ControlMappingCreateInput = {
  control_id: string;
  requirement_id: string;
};

export type ControlMappingCreateResult =
  | { input: ControlMappingCreateInput }
  | { error: string; detail?: string };

export function validateControlMappingCreate(
  body: unknown
): ControlMappingCreateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // control_id — required UUID
  if (!isNonEmptyString(b["control_id"])) {
    return { error: "control_id_required" };
  }
  if (!isUuid(b["control_id"])) {
    return { error: "control_id_must_be_uuid" };
  }
  const control_id = b["control_id"] as string;

  // requirement_id — required UUID
  if (!isNonEmptyString(b["requirement_id"])) {
    return { error: "requirement_id_required" };
  }
  if (!isUuid(b["requirement_id"])) {
    return { error: "requirement_id_must_be_uuid" };
  }
  const requirement_id = b["requirement_id"] as string;

  return { input: { control_id, requirement_id } };
}
