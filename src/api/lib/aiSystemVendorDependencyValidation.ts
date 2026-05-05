/**
 * aiSystemVendorDependencyValidation.ts — Pure validation for
 * ai_system_vendor_dependencies create input.
 *
 * No I/O. No DB access. Fully unit-testable.
 *
 * Tenant rule: organization_id is NEVER sourced from the request body. It is
 * sourced exclusively from req.organizationContext at the route layer.
 */

import { sanitizeString } from "./sanitize.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_NOTES = 500;

export const DEPENDENCY_ROLES = [
  "model_provider",
  "runtime",
  "registry",
  "training_data",
  "feature_store",
  "mlops_platform",
  "data_source",
  "observability",
  "other"
] as const;

export type DependencyRole = (typeof DEPENDENCY_ROLES)[number];

export type AiSystemVendorDependencyCreateInput = {
  ai_system_id: string;
  vendor_id: string;
  dependency_role: DependencyRole;
  notes: string | null;
};

export type AiSystemVendorDependencyCreateResult =
  | { input: AiSystemVendorDependencyCreateInput }
  | { error: string; detail?: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

export function isDependencyRole(v: unknown): v is DependencyRole {
  return (
    typeof v === "string" &&
    (DEPENDENCY_ROLES as readonly string[]).includes(v)
  );
}

export function validateAiSystemVendorDependencyCreate(
  body: unknown
): AiSystemVendorDependencyCreateResult {
  if (!isPlainObject(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  if (!("ai_system_id" in b) || !isNonEmptyString(b.ai_system_id)) {
    return { error: "ai_system_id_required" };
  }
  const aiSystemId = (b.ai_system_id as string).trim();
  if (!isUuid(aiSystemId)) {
    return { error: "ai_system_id_must_be_uuid" };
  }

  if (!("vendor_id" in b) || !isNonEmptyString(b.vendor_id)) {
    return { error: "vendor_id_required" };
  }
  const vendorId = (b.vendor_id as string).trim();
  if (!isUuid(vendorId)) {
    return { error: "vendor_id_must_be_uuid" };
  }

  if (!("dependency_role" in b) || !isNonEmptyString(b.dependency_role)) {
    return { error: "dependency_role_required" };
  }
  const role = (b.dependency_role as string).trim();
  if (!isDependencyRole(role)) {
    return {
      error: "dependency_role_invalid",
      detail: `dependency_role must be one of: ${DEPENDENCY_ROLES.join(", ")}`
    };
  }

  let notes: string | null = null;
  if ("notes" in b && b.notes !== null && b.notes !== undefined) {
    if (typeof b.notes !== "string") {
      return { error: "notes_must_be_string" };
    }
    const raw = b.notes.trim();
    if (raw.length > MAX_NOTES) {
      return {
        error: "notes_too_long",
        detail: `notes must be ${MAX_NOTES} characters or fewer`
      };
    }
    notes = raw.length === 0 ? null : sanitizeString(raw, MAX_NOTES);
  }

  return {
    input: {
      ai_system_id: aiSystemId,
      vendor_id: vendorId,
      dependency_role: role,
      notes
    }
  };
}
