"use server";

/**
 * Engagement-participant server actions (VA-P1).
 *
 * THIN proxies, the same shape as the vendor-contact and engagement actions:
 * re-read the engine token from the server-only session, forward, revalidate.
 * No rules live here — the engine owns who may be added, the one-coordinator
 * invariant, the per-participant credential lifecycle and the refusal to reach
 * another supplier's people, and its words come back verbatim rather than being
 * re-invented in the UI.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  addEngagementParticipant,
  revokeEngagementParticipant,
  isVendorContactFailure,
  type ParticipantRole,
} from "@/lib/api";

export type ParticipantActionState =
  | { ok: true; inviteToken?: string; expiresAt?: string; emailDelivery?: string; reused?: boolean }
  | { ok: false; error: string };

const MESSAGES: Record<string, string> = {
  contact_not_found: "That person is not in this supplier's contact directory.",
  contact_inactive: "That contact is marked inactive. Reactivate them or choose someone else.",
  coordinator_exists:
    "This assessment already has a main contact. Revoke them first, or add this person as a contributor.",
  engagement_not_found: "This engagement was not found for your organization.",
  participant_not_found: "That participant no longer exists on this engagement.",
  contact_id_required: "Choose someone from this supplier's contact directory.",
  invalid_participant_role: "Choose a valid role.",
  not_found: "Vendor Assurance is not available on this environment yet.",
};

function text(error: string, message?: string): string {
  return MESSAGES[error] ?? message ?? `That didn't work (${error}).`;
}

async function token(): Promise<string | null> {
  const session = await getSession();
  return session.jwtToken ?? session.apiKey ?? null;
}

export async function addParticipant(
  engagementId: string,
  contactId: string,
  role: ParticipantRole
): Promise<ParticipantActionState> {
  const t = await token();
  if (!t) return { ok: false, error: "Not authenticated" };
  const result = await addEngagementParticipant(t, engagementId, {
    contact_id: contactId,
    participant_role: role,
  });
  if (isVendorContactFailure(result)) {
    return { ok: false, error: text(result.failure.error, result.failure.message) };
  }
  revalidatePath(`/vendor-engagements/${engagementId}`);
  return {
    ok: true,
    // Passed straight back to the caller and rendered once. It is never stored
    // client-side and cannot be re-read: only a hash reaches the database.
    inviteToken: result.invite_token,
    expiresAt: result.expires_at,
    emailDelivery: result.email_delivery,
    reused: result.reused,
  };
}

export async function revokeParticipant(
  engagementId: string,
  participantId: string,
  reason?: string
): Promise<ParticipantActionState> {
  const t = await token();
  if (!t) return { ok: false, error: "Not authenticated" };
  const result = await revokeEngagementParticipant(t, engagementId, participantId, reason);
  if (isVendorContactFailure(result)) {
    return { ok: false, error: text(result.failure.error, result.failure.message) };
  }
  revalidatePath(`/vendor-engagements/${engagementId}`);
  return { ok: true };
}
