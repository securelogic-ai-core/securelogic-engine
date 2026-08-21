"use server";

/**
 * Vendor-assurance document-review server actions.
 *
 * These are THIN proxies. Each one re-reads the engine token from the
 * server-only iron-session, forwards to the engine via the typed Bearer-auth
 * wrappers in @/lib/api, and revalidates the affected paths. No DB access, no
 * direct audit writes — persistence and audit live entirely in the engine
 * routes (src/api/routes/vendorAssuranceDocuments.ts). Same shape as
 * app/src/app/vendors/[id]/actions.ts.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  overrideVendorAssuranceField,
  approveVendorAssuranceDocument as engineApproveDocument,
  requestVendorAssuranceManualReview as engineRequestManualReview,
  rejectVendorAssuranceDocument as engineRejectDocument,
  rematchCuecs as engineRematchCuecs,
  createCuecMapping as engineCreateCuecMapping,
  updateCuecMapping as engineUpdateCuecMapping,
  updateCuecReviewStatus as engineUpdateCuecReviewStatus,
  promoteCuecToFinding as enginePromoteCuecToFinding,
  searchControls as engineSearchControls,
  type ControlSummary,
} from "@/lib/api";

export type VendorAssuranceActionState = { ok: true } | { ok: false; error: string };

async function sessionToken(): Promise<string | null> {
  const session = await getSession();
  return session.jwtToken ?? session.apiKey ?? null;
}

function revalidateDocument(documentId: string): void {
  revalidatePath(`/vendor-assurance/${documentId}`);
  revalidatePath("/vendor-assurance/queue");
}

export async function overrideField(
  documentId: string,
  fieldName: string,
  newValue: unknown,
  reason: string
): Promise<VendorAssuranceActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await overrideVendorAssuranceField(token, documentId, fieldName, newValue, reason);
  if ("error" in result) return { ok: false, error: result.error };
  revalidateDocument(documentId);
  return { ok: true };
}

export async function approveDocument(documentId: string): Promise<VendorAssuranceActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await engineApproveDocument(token, documentId);
  if ("error" in result) return { ok: false, error: result.error };
  revalidateDocument(documentId);
  return { ok: true };
}

export async function requestManualReview(
  documentId: string,
  comment?: string
): Promise<VendorAssuranceActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await engineRequestManualReview(token, documentId, comment);
  if ("error" in result) return { ok: false, error: result.error };
  revalidateDocument(documentId);
  return { ok: true };
}

export async function rejectExtraction(
  documentId: string,
  reason: string
): Promise<VendorAssuranceActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await engineRejectDocument(token, documentId, reason);
  if ("error" in result) return { ok: false, error: result.error };
  revalidateDocument(documentId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CUEC matcher: re-match, mapping accept/dismiss/create, no-match marker, control search
// ---------------------------------------------------------------------------

export async function rematchDocumentCuecs(documentId: string): Promise<VendorAssuranceActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await engineRematchCuecs(token, documentId);
  if ("error" in result) return { ok: false, error: result.error };
  revalidateDocument(documentId);
  return { ok: true };
}

export async function acceptCuecMapping(mappingId: string, documentId: string): Promise<VendorAssuranceActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await engineUpdateCuecMapping(token, mappingId, "accepted");
  if ("error" in result) return { ok: false, error: result.error };
  revalidateDocument(documentId);
  return { ok: true };
}

export async function dismissCuecMapping(mappingId: string, documentId: string, reason: string): Promise<VendorAssuranceActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await engineUpdateCuecMapping(token, mappingId, "dismissed", reason);
  if ("error" in result) return { ok: false, error: result.error };
  revalidateDocument(documentId);
  return { ok: true };
}

export async function createManualCuecMapping(
  cuecId: string,
  controlId: string,
  documentId: string,
  reason?: string
): Promise<VendorAssuranceActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await engineCreateCuecMapping(token, cuecId, controlId, reason);
  if ("error" in result) return { ok: false, error: result.error };
  revalidateDocument(documentId);
  return { ok: true };
}

/**
 * VA-2. Record what the reviewer concluded about this vendor requirement.
 *
 * `gap` asserts that the requirement applies to this organisation and it does
 * NOT meet it — the only determination that justifies remediation work, and the
 * only one the engine requires a reason for. Recording it does not create the
 * work: promotion is a separate, deliberate act (see promoteCuecGapToFinding).
 */
export async function determineCuec(
  cuecId: string,
  documentId: string,
  determination: "not_applicable" | "satisfied" | "gap",
  reason?: string,
): Promise<VendorAssuranceActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };

  // Checked here as well as in the engine so the reviewer gets an immediate,
  // specific message rather than a round-trip error code.
  if (determination === "gap" && (!reason || reason.trim().length === 0)) {
    return {
      ok: false,
      error:
        "Recording a gap says this organisation does not meet a control the vendor " +
        "requires of it. Please say why, so the determination can be defended later.",
    };
  }

  const result = await engineUpdateCuecReviewStatus(token, cuecId, determination, reason);
  if ("error" in result) return { ok: false, error: result.error };
  revalidateDocument(documentId);
  return { ok: true };
}

/**
 * Turn a determined gap into an ordinary SecureLogic Finding.
 *
 * Severity is the reviewer's call and has no default: it sets the remediation
 * deadline through the organisation's own SLA policy, and a deadline nobody
 * chose is a deadline nobody owns.
 */
export async function promoteCuecGapToFinding(
  cuecId: string,
  documentId: string,
  severity: "Critical" | "High" | "Moderate" | "Low",
): Promise<VendorAssuranceActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await enginePromoteCuecToFinding(token, cuecId, severity);
  if ("error" in result) return { ok: false, error: result.error };
  revalidateDocument(documentId);
  return { ok: true };
}

/** @deprecated VA-2 — use determineCuec. Kept so existing callers keep working. */
export async function markCuecNoMatch(cuecId: string, documentId: string, reason?: string): Promise<VendorAssuranceActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await engineUpdateCuecReviewStatus(token, cuecId, "reviewed_no_match", reason);
  if ("error" in result) return { ok: false, error: result.error };
  revalidateDocument(documentId);
  return { ok: true };
}

export async function clearCuecNoMatch(cuecId: string, documentId: string): Promise<VendorAssuranceActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await engineUpdateCuecReviewStatus(token, cuecId, "pending");
  if ("error" in result) return { ok: false, error: result.error };
  revalidateDocument(documentId);
  return { ok: true };
}

/** Type-ahead control search for the ControlPicker. Returns [] on auth failure / error. */
export async function searchControlsAction(query: string): Promise<ControlSummary[]> {
  const token = await sessionToken();
  if (!token) return [];
  return engineSearchControls(token, query);
}
