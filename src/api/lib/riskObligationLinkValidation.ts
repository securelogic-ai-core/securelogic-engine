/**
 * riskObligationLinkValidation.ts — Pure validation for risk_obligation_links input.
 *
 * No I/O. No DB access. Fully unit-testable.
 *
 * Tenant rule: organization_id is NEVER sourced from the request body. It is
 * sourced exclusively from req.organizationContext at the route layer.
 *
 * Mirrors riskControlLinkValidation.ts shape — only the entity name differs.
 * RR-6 routes nest under /api/risks/:id/obligations (so :id supplies risk_id
 * from the path), so the create-body validator only needs to enforce
 * obligation_id + optional note. The route validates :id + :obligationId
 * UUIDs separately.
 */

import { sanitizeString } from "./sanitize.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_NOTE = 500;

export type RiskObligationLinkCreateInput = {
  obligation_id: string;
  note: string | null;
};

export type RiskObligationLinkCreateResult =
  | { input: RiskObligationLinkCreateInput }
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

export function validateRiskObligationLinkCreate(
  body: unknown
): RiskObligationLinkCreateResult {
  if (!isPlainObject(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  if (!("obligation_id" in b) || !isNonEmptyString(b.obligation_id)) {
    return { error: "obligation_id_required" };
  }
  const obligationId = (b.obligation_id as string).trim();
  if (!isUuid(obligationId)) {
    return { error: "obligation_id_must_be_uuid" };
  }

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

  return {
    input: {
      obligation_id: obligationId,
      note
    }
  };
}
