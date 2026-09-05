"use server";

/**
 * Vendor contact-directory server actions (VA-C1).
 *
 * THIN proxies, same shape as the vendor-engagement actions: re-read the engine
 * token from the server-only session, forward to the typed wrappers in
 * @/lib/api, revalidate the vendor page. No DB access and no rules — the engine
 * owns uniqueness, the single-primary invariant and the refusal to delete a
 * contact that has already been sent a questionnaire, and its words come back
 * here verbatim rather than being re-invented in the UI.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  createVendorContact,
  updateVendorContact,
  deleteVendorContact,
  isVendorContactFailure,
  type VendorContact,
  type VendorContactRole,
} from "@/lib/api";

export type ContactActionState =
  | { ok: true; contact?: VendorContact }
  /**
   * WA-2: a refusal may name the contact it is about. `conflict` is populated
   * only for `contact_already_exists`, and only so the caller can offer the one
   * action that resolves it — reactivating an invisible inactive row rather
   * than adding a duplicate the unique index will refuse forever.
   */
  | {
      ok: false;
      error: string;
      conflict?: { id: string; status: "active" | "inactive"; name: string };
    };

const MESSAGES: Record<string, string> = {
  // NO entry for `contact_already_exists` on purpose. `text()` resolves
  // MESSAGES first, so a static string here would SHADOW the engine's sentence
  // — and only the engine knows whether the clashing contact is active or
  // inactive, which is the whole difference between "you already added them"
  // and "reactivate the person you cannot see".
  contact_in_use:
    "This contact has been sent a questionnaire and is part of that record. Mark them inactive instead.",
  contact_not_found: "That contact no longer exists.",
  vendor_not_found: "Vendor was not found for this organization.",
  invalid_email: "Enter a valid email address.",
  full_name_required: "A name is required.",
  invalid_contact_role: "Choose one of the available contact roles.",
  not_found: "Vendor Assurance is not available on this environment yet.",
};

function text(error: string, message?: string): string {
  return MESSAGES[error] ?? message ?? `That didn't work (${error}).`;
}

async function token(): Promise<string | null> {
  const session = await getSession();
  return session.jwtToken ?? session.apiKey ?? null;
}

export async function addVendorContact(
  vendorId: string,
  input: {
    full_name: string;
    email: string;
    title?: string;
    phone?: string;
    contact_role?: VendorContactRole;
    is_primary_contact?: boolean;
  }
): Promise<ContactActionState> {
  const t = await token();
  if (!t) return { ok: false, error: "Not authenticated" };
  const result = await createVendorContact(t, vendorId, input);
  if (isVendorContactFailure(result)) {
    const f = result.failure;
    return {
      ok: false,
      error: text(f.error, f.message),
      ...(f.contact_id && f.contact_status
        ? { conflict: { id: f.contact_id, status: f.contact_status, name: f.contact_name ?? "That contact" } }
        : {}),
    };
  }
  revalidatePath(`/vendors/${vendorId}`);
  return { ok: true, contact: result.contact };
}

export async function editVendorContact(
  vendorId: string,
  contactId: string,
  patch: Partial<VendorContact>
): Promise<ContactActionState> {
  const t = await token();
  if (!t) return { ok: false, error: "Not authenticated" };
  const result = await updateVendorContact(t, vendorId, contactId, patch);
  if (isVendorContactFailure(result)) {
    return { ok: false, error: text(result.failure.error, result.failure.message) };
  }
  revalidatePath(`/vendors/${vendorId}`);
  return { ok: true, contact: result.contact };
}

export async function removeVendorContact(
  vendorId: string,
  contactId: string
): Promise<ContactActionState> {
  const t = await token();
  if (!t) return { ok: false, error: "Not authenticated" };
  const result = await deleteVendorContact(t, vendorId, contactId);
  if (isVendorContactFailure(result)) {
    return { ok: false, error: text(result.failure.error, result.failure.message) };
  }
  revalidatePath(`/vendors/${vendorId}`);
  return { ok: true };
}
