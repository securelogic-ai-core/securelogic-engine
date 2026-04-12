/**
 * frameworkValidation.ts — Pure validation for framework routes.
 *
 * No I/O. Returns a discriminated union: { input } | { error, detail? }.
 */

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// validateFrameworkCreate
// ---------------------------------------------------------------------------

export type FrameworkCreateInput = {
  name: string;
  version: string;
};

export type FrameworkCreateResult =
  | { input: FrameworkCreateInput }
  | { error: string; detail?: string };

export function validateFrameworkCreate(body: unknown): FrameworkCreateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // name — required non-empty string
  if (!isNonEmptyString(b["name"])) {
    return { error: "name_required" };
  }
  const name = (b["name"] as string).trim();

  // version — required non-empty string
  if (!isNonEmptyString(b["version"])) {
    return { error: "version_required" };
  }
  const version = (b["version"] as string).trim();

  return { input: { name, version } };
}
