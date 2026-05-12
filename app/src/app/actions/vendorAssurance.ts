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
