/**
 * aiSystemValidation.ts
 *
 * Pure validation logic for the AI systems API.
 * No I/O dependencies — fully unit-testable without a database.
 */

import { sanitizeString } from "./sanitize.js";

const MAX_NAME = 255;
const MAX_USE_CASE = 2000;
const MAX_SHORT_FIELD = 100;

const VALID_CRITICALITIES = new Set(["critical", "high", "medium", "low"]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isUuid(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

// ----------------------------------------------------------------
// AI System Create
// ----------------------------------------------------------------

export type AiSystemCreateInput = {
  name: string;
  use_case: string | null;
  owner_user_id: string | null;
  model_type: string | null;
  data_classification: string | null;
  deployment_status: string | null;
  criticality: string | null;
  risk_classification: string | null;
};

export type AiSystemCreateValidationResult =
  | { input: AiSystemCreateInput }
  | { error: string; detail?: string };

export function validateAiSystemCreate(
  body: unknown
): AiSystemCreateValidationResult {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // name — required non-empty string
  if (!isNonEmptyString(b["name"])) {
    return { error: "name_required" };
  }

  // criticality — optional, constrained to canonical values
  if (
    "criticality" in b &&
    b["criticality"] !== null &&
    b["criticality"] !== undefined
  ) {
    if (
      !isNonEmptyString(b["criticality"]) ||
      !VALID_CRITICALITIES.has(b["criticality"])
    ) {
      return {
        error: "invalid_criticality",
        detail: `must be one of: ${[...VALID_CRITICALITIES].join(", ")}`
      };
    }
  }

  // owner_user_id — optional UUID or null
  if (
    "owner_user_id" in b &&
    b["owner_user_id"] !== null &&
    b["owner_user_id"] !== undefined &&
    !isUuid(b["owner_user_id"])
  ) {
    return { error: "owner_user_id_must_be_uuid" };
  }

  const use_case =
    "use_case" in b
      ? typeof b["use_case"] === "string" && b["use_case"].trim().length > 0
        ? sanitizeString(b["use_case"].trim(), MAX_USE_CASE)
        : null
      : null;

  const model_type =
    "model_type" in b
      ? typeof b["model_type"] === "string" && b["model_type"].trim().length > 0
        ? sanitizeString(b["model_type"].trim(), MAX_SHORT_FIELD)
        : null
      : null;

  const data_classification =
    "data_classification" in b
      ? typeof b["data_classification"] === "string" &&
        b["data_classification"].trim().length > 0
        ? sanitizeString(b["data_classification"].trim(), MAX_SHORT_FIELD)
        : null
      : null;

  const deployment_status =
    "deployment_status" in b
      ? typeof b["deployment_status"] === "string" &&
        b["deployment_status"].trim().length > 0
        ? sanitizeString(b["deployment_status"].trim(), MAX_SHORT_FIELD)
        : null
      : null;

  const criticality =
    "criticality" in b &&
    isNonEmptyString(b["criticality"]) &&
    VALID_CRITICALITIES.has(b["criticality"])
      ? (b["criticality"] as string)
      : null;

  const risk_classification =
    "risk_classification" in b
      ? typeof b["risk_classification"] === "string" &&
        b["risk_classification"].trim().length > 0
        ? sanitizeString(b["risk_classification"].trim(), MAX_SHORT_FIELD)
        : null
      : null;

  const owner_user_id =
    "owner_user_id" in b && isUuid(b["owner_user_id"])
      ? (b["owner_user_id"] as string)
      : null;

  return {
    input: {
      name: sanitizeString((b["name"] as string).trim(), MAX_NAME),
      use_case,
      owner_user_id,
      model_type,
      data_classification,
      deployment_status,
      criticality,
      risk_classification
    }
  };
}
