/**
 * actionValidation.ts
 *
 * Pure validation logic for the actions API.
 * No I/O dependencies — fully unit-testable without a database.
 */

const VALID_SOURCE_TYPES = new Set([
  "assessment",
  "finding",
  "signal",
  "manual",
  "risk"
]);

const VALID_PRIORITIES = new Set([
  "immediate",
  "near_term",
  "planned",
  "watch"
]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isUuid(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

function isIsoDate(v: unknown): boolean {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export type ActionCreateInput = {
  title: string;
  source_type: string;
  priority: string;
  description: string | null;
  action_type: string | null;
  source_id: string | null;
  due_date: string | null;
  owner_user_id: string | null;
};

export type ActionCreateValidationResult =
  | { input: ActionCreateInput }
  | { error: string; detail?: string };

export function validateActionCreate(
  body: unknown
): ActionCreateValidationResult {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b["title"])) {
    return { error: "title_required" };
  }

  if (!isNonEmptyString(b["source_type"])) {
    return { error: "source_type_required" };
  }
  if (!VALID_SOURCE_TYPES.has(b["source_type"] as string)) {
    return {
      error: "invalid_source_type",
      detail: `must be one of: ${[...VALID_SOURCE_TYPES].join(", ")}`
    };
  }

  if (!isNonEmptyString(b["priority"])) {
    return { error: "priority_required" };
  }
  if (!VALID_PRIORITIES.has(b["priority"] as string)) {
    return {
      error: "invalid_priority",
      detail: `must be one of: ${[...VALID_PRIORITIES].join(", ")}`
    };
  }

  if (
    "source_id" in b &&
    b["source_id"] !== null &&
    b["source_id"] !== undefined &&
    !isUuid(b["source_id"])
  ) {
    return { error: "source_id_must_be_uuid" };
  }

  if (
    "owner_user_id" in b &&
    b["owner_user_id"] !== null &&
    b["owner_user_id"] !== undefined &&
    !isUuid(b["owner_user_id"])
  ) {
    return { error: "owner_user_id_must_be_uuid" };
  }

  if (
    "due_date" in b &&
    b["due_date"] !== null &&
    b["due_date"] !== undefined &&
    !isIsoDate(b["due_date"])
  ) {
    return { error: "due_date_must_be_yyyy_mm_dd" };
  }

  const description =
    "description" in b
      ? typeof b["description"] === "string"
        ? b["description"]
        : null
      : null;

  const action_type =
    "action_type" in b
      ? typeof b["action_type"] === "string"
        ? b["action_type"]
        : null
      : null;

  const source_id =
    "source_id" in b && isUuid(b["source_id"])
      ? (b["source_id"] as string)
      : null;

  const due_date =
    "due_date" in b && isIsoDate(b["due_date"])
      ? (b["due_date"] as string)
      : null;

  const owner_user_id =
    "owner_user_id" in b && isUuid(b["owner_user_id"])
      ? (b["owner_user_id"] as string)
      : null;

  return {
    input: {
      title: (b["title"] as string).trim(),
      source_type: b["source_type"] as string,
      priority: b["priority"] as string,
      description,
      action_type,
      source_id,
      due_date,
      owner_user_id
    }
  };
}
