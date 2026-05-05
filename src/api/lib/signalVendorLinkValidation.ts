/**
 * signalVendorLinkValidation.ts — Pure validation for signal_vendor_links input.
 *
 * No I/O. No DB access. Fully unit-testable.
 *
 * Tenant rule: organization_id is NEVER sourced from the request body. It is
 * sourced exclusively from req.organizationContext at the route layer.
 */

import { sanitizeString } from "./sanitize.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_NOTE = 500;

export type SignalVendorLinkCreateInput = {
  signal_id: string;
  vendor_id: string;
  note: string | null;
};

export type SignalVendorLinkCreateResult =
  | { input: SignalVendorLinkCreateInput }
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

export function validateSignalVendorLinkCreate(
  body: unknown
): SignalVendorLinkCreateResult {
  if (!isPlainObject(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  if (!("signal_id" in b) || !isNonEmptyString(b.signal_id)) {
    return { error: "signal_id_required" };
  }
  const signalId = (b.signal_id as string).trim();
  if (!isUuid(signalId)) {
    return { error: "signal_id_must_be_uuid" };
  }

  if (!("vendor_id" in b) || !isNonEmptyString(b.vendor_id)) {
    return { error: "vendor_id_required" };
  }
  const vendorId = (b.vendor_id as string).trim();
  if (!isUuid(vendorId)) {
    return { error: "vendor_id_must_be_uuid" };
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
      signal_id: signalId,
      vendor_id: vendorId,
      note
    }
  };
}
