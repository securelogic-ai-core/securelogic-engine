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
