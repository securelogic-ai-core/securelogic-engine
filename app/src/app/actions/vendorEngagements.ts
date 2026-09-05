"use server";

/**
 * Vendor-engagement workflow server actions.
 *
 * THIN proxies, same shape as app/src/app/actions/vendorAssurance.ts: re-read
 * the engine token from the server-only session, forward to the typed wrappers
 * in @/lib/api, revalidate the affected paths. No DB access, no workflow logic
 * — the engine's state machine is the single authority on legality, and every
 * refusal comes back here as the engine's own words
 * (vendorEngagementFailureText), which the UI surfaces verbatim.
 *
 * The ONE exception to "return nothing sensitive": issueEngagement passes the
 * raw invite token through to the client for its one-time display. It is never
 * written anywhere on the way through — the engine stores only the hash.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  createVendorEngagement,
  overrideVendorEngagementInherent,
  resolveVendorEngagementScope,
  issueVendorEngagement,
  reissueVendorEngagementInvite,
  revokeVendorEngagementInvite,
  recomputeVendorEngagementRisk,
  recordVendorEngagementDecision,
  reviewVendorEngagementEvidence,
  promoteVendorEngagementFindings,
  raiseApplicabilityChallenge,
  reseedVendorEngagementFromRelationship,
  postVendorEngagementComment,
  beginVendorEngagementReview,
  completeVendorEngagementAnalysis,
  startVendorEngagementMonitoring,
  isEngagementFailure,
  vendorEngagementFailureText,
  type VendorEngagementIntakeInput,
  type VendorEngagementIssueInput,
  type VendorInviteDeliveryState,
  type VendorEngagementDecision,
  type VendorEngagementPromotionResult,
  recordEngagementDisposition,
} from "@/lib/api";

export type EngagementActionState = { ok: true } | { ok: false; error: string };

async function sessionToken(): Promise<string | null> {
  const session = await getSession();
  return session.jwtToken ?? session.apiKey ?? null;
}

function revalidateEngagement(id: string): void {
  revalidatePath(`/vendor-engagements/${id}`);
  revalidatePath("/vendor-engagements");
}

export async function createEngagement(input: {
  vendor_id: string;
  engagement_type: "initial" | "periodic" | "targeted" | "event_driven";
  title?: string;
  intake: VendorEngagementIntakeInput;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await createVendorEngagement(token, input);
  if (isEngagementFailure(result)) {
    return { ok: false, error: vendorEngagementFailureText(result.failure) };
  }
  revalidatePath("/vendor-engagements");
  return { ok: true, id: result.id };
}

export async function overrideInherent(
  id: string,
  rating: string,
  rationale: string
): Promise<EngagementActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await overrideVendorEngagementInherent(token, id, rating, rationale);
  if (isEngagementFailure(result)) {
    return { ok: false, error: vendorEngagementFailureText(result.failure) };
  }
  revalidateEngagement(id);
  return { ok: true };
}

export async function resolveScope(
  id: string
): Promise<{ ok: true; scoped: number; excluded: number } | { ok: false; error: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await resolveVendorEngagementScope(token, id);
  if (isEngagementFailure(result)) {
    return { ok: false, error: vendorEngagementFailureText(result.failure) };
  }
  revalidateEngagement(id);
  return { ok: true, scoped: result.scoped, excluded: result.excluded };
}

/**
 * Goal §A/§B: issue to a directory contact with a composed invitation that
 * SecureLogic sends. The raw token still passes through ONCE as the
 * secondary "copy secure link" recovery path — never written anywhere here.
 */
export type IssueEngagementResult =
  | {
      ok: true;
      inviteId: string;
      inviteToken: string;
      expiresAt: string;
      contactId: string | null;
      contactEmail: string;
      dueDate: string | null;
      emailDelivery: VendorInviteDeliveryState;
      emailDeliveryDetail: string | null;
    }
  | { ok: false; error: string };

const ISSUE_MESSAGES: Record<string, string> = {
  contact_not_found: "That contact is not in this vendor's directory.",
  contact_inactive: "That contact is marked inactive. Reactivate them or choose someone else.",
  valid_contact_email_required: "Choose a contact, or enter a valid email address.",
  due_date_in_past: "The due date has already passed.",
  invalid_due_date: "Enter the due date as a calendar date.",
  message_too_long: "Keep the invitation message under 4,000 characters.",
  empty_scope: "Compose the assessment first — an empty questionnaire cannot be sent.",
  no_active_invite: "There is no active invitation to revoke.",
};

function issueText(f: { error: string; message?: string; reason?: string }): string {
  return ISSUE_MESSAGES[f.error] ?? vendorEngagementFailureText(f as never);
}

export async function issueEngagement(
  id: string,
  input: VendorEngagementIssueInput
): Promise<IssueEngagementResult> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await issueVendorEngagement(token, id, input);
  if (isEngagementFailure(result)) {
    return { ok: false, error: issueText(result.failure) };
  }
  revalidateEngagement(id);
  return {
    ok: true,
    inviteId: result.invite_id,
    inviteToken: result.invite_token,
    expiresAt: result.expires_at,
    contactId: result.contact_id,
    contactEmail: result.contact_email,
    dueDate: result.due_date,
    emailDelivery: result.email_delivery,
    emailDeliveryDetail: result.email_delivery_detail,
  };
}

/** Resend / change recipient — a replacement credential; the prior one dies. */
export async function reissueInvite(
  id: string,
  input: VendorEngagementIssueInput
): Promise<IssueEngagementResult> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await reissueVendorEngagementInvite(token, id, input);
  if (isEngagementFailure(result)) {
    return { ok: false, error: issueText(result.failure) };
  }
  revalidateEngagement(id);
  return {
    ok: true,
    inviteId: result.invite_id,
    inviteToken: result.invite_token,
    expiresAt: result.expires_at,
    contactId: result.contact_id,
    contactEmail: result.contact_email,
    dueDate: result.due_date,
    emailDelivery: result.email_delivery,
    emailDeliveryDetail: result.email_delivery_detail,
  };
}

export async function revokeInvite(
  id: string,
  reason?: string
): Promise<{ ok: true; sessionsRevoked: number } | { ok: false; error: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await revokeVendorEngagementInvite(token, id, reason);
  if (isEngagementFailure(result)) {
    return { ok: false, error: issueText(result.failure) };
  }
  revalidateEngagement(id);
  return { ok: true, sessionsRevoked: result.sessions_revoked };
}

export async function beginReview(id: string): Promise<EngagementActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await beginVendorEngagementReview(token, id);
  if (isEngagementFailure(result)) {
    return { ok: false, error: vendorEngagementFailureText(result.failure) };
  }
  revalidateEngagement(id);
  return { ok: true };
}

export async function completeAnalysis(
  id: string
): Promise<
  | { ok: true; analysisCoverage: "full" | "partial" | "deterministic_only" }
  | { ok: false; error: string }
> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await completeVendorEngagementAnalysis(token, id);
  if (isEngagementFailure(result)) {
    return { ok: false, error: vendorEngagementFailureText(result.failure) };
  }
  revalidateEngagement(id);
  return { ok: true, analysisCoverage: result.analysis_coverage };
}

export async function recomputeRisk(
  id: string
): Promise<
  | {
      ok: true;
      residualRating: string;
      residualScore: number;
      effectivenessScore: number;
      inherentUnderstated: boolean;
    }
  | { ok: false; error: string }
> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await recomputeVendorEngagementRisk(token, id);
  if (isEngagementFailure(result)) {
    return { ok: false, error: vendorEngagementFailureText(result.failure) };
  }
  revalidateEngagement(id);
  return {
    ok: true,
    residualRating: result.residual.rating,
    residualScore: result.residual.score,
    effectivenessScore: result.effectiveness.score,
    inherentUnderstated: result.residual.inherent_understated,
  };
}

export async function recordDecision(
  id: string,
  decision: VendorEngagementDecision,
  rationale: string,
  expiresAt?: string
): Promise<EngagementActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await recordVendorEngagementDecision(token, id, decision, rationale, expiresAt);
  if (isEngagementFailure(result)) {
    return { ok: false, error: vendorEngagementFailureText(result.failure) };
  }
  revalidateEngagement(id);
  return { ok: true };
}

export async function startMonitoring(
  id: string,
  opts: { cadenceDays?: number; nextReviewDue?: string }
): Promise<{ ok: true; nextReviewDue: string } | { ok: false; error: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await startVendorEngagementMonitoring(token, id, opts);
  if (isEngagementFailure(result)) {
    return { ok: false, error: vendorEngagementFailureText(result.failure) };
  }
  revalidateEngagement(id);
  return { ok: true, nextReviewDue: result.next_review_due };
}

export async function promoteFindings(
  id: string
): Promise<
  | { ok: true; result: VendorEngagementPromotionResult }
  | { ok: false; error: string }
> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await promoteVendorEngagementFindings(token, id);
  if (isEngagementFailure(result)) {
    return { ok: false, error: vendorEngagementFailureText(result.failure) };
  }
  revalidateEngagement(id);
  return { ok: true, result };
}

export async function reviewEvidence(
  id: string,
  evidenceId: string,
  supports: boolean,
  note?: string
): Promise<EngagementActionState> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await reviewVendorEngagementEvidence(token, id, evidenceId, supports, note);
  if (isEngagementFailure(result)) {
    return { ok: false, error: vendorEngagementFailureText(result.failure) };
  }
  revalidateEngagement(id);
  return { ok: true };
}

export async function postComment(
  id: string,
  body: string,
  visibility: "internal" | "vendor",
  requirementId?: string
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await postVendorEngagementComment(token, id, body, visibility, requirementId);
  if (isEngagementFailure(result)) {
    return { ok: false, error: vendorEngagementFailureText(result.failure) };
  }
  revalidateEngagement(id);
  return { ok: true, status: result.status };
}

/**
 * WA-2 / owner ruling 2 — record a disagreement with a composition decision.
 *
 * Returns the engine's own `resolution` sentence rather than a locally-written
 * one. What a challenge resolves to depends on engine behaviour (today: a
 * corrected intake moves the RELATIONSHIP, and this engagement composes on the
 * facts it was opened with), and a second copy of that explanation in the UI
 * would drift from it the moment that behaviour is ruled on.
 */
export async function raiseChallenge(
  id: string,
  input: { requirement_reference: string; reason: string }
): Promise<{ ok: true; resolution: string } | { ok: false; error: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await raiseApplicabilityChallenge(token, id, input);
  if ("failure" in result) {
    return {
      ok: false,
      error:
        result.failure.message ??
        (result.failure.error === "transport"
          ? "The request did not reach SecureLogic, so nothing was recorded."
          : `That didn't work (${result.failure.error}).`),
    };
  }
  revalidateEngagement(id);
  return { ok: true, resolution: result.resolution };
}

/**
 * WA-3 / R8-1 — rebase a pre-issue engagement onto its relationship's current
 * determination.
 *
 * Returns the changed fields so the analyst sees WHAT moved, and the engine's
 * own next-step sentence rather than a copy of it here: the reseed deliberately
 * does not recompose, and the engine is the one place that says so.
 */
export async function reseedFromRelationship(
  id: string,
  reason: string
): Promise<
  | { ok: true; changed: { field: string; from: unknown; to: unknown }[]; nextStep: string }
  | { ok: false; error: string }
> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await reseedVendorEngagementFromRelationship(token, id, reason);
  if ("failure" in result) {
    return {
      ok: false,
      error:
        result.failure.message ??
        (result.failure.error === "transport"
          ? "The request did not reach SecureLogic, so nothing was changed."
          : `That didn't work (${result.failure.error}).`),
    };
  }
  revalidateEngagement(id);
  return {
    ok: true,
    changed: result.reseed.changed_fields.map((c) => ({
      field: c.field,
      from: c.engagement_value,
      to: c.relationship_value,
    })),
    nextStep: result.next_step.message,
  };
}

/**
 * WA-4 ruling 5 — record the analyst's disposition of an engagement.
 *
 * Returns the engine's own refusal text rather than a generic failure: the
 * rationale floor and the attention-window rule are things the analyst has to
 * be able to act on, and WA-2's re-intake gate is the standing lesson about
 * shipping a refusal with nowhere to answer it.
 *
 * `created_finding` is passed straight through so the UI can state, from the
 * server's own answer rather than from a local assumption, that recording a
 * disposition did not promote anything.
 */
export async function recordDisposition(
  id: string,
  input: { disposition: string; rationale?: string }
): Promise<{ ok: true; createdFinding: boolean } | { ok: false; error: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await recordEngagementDisposition(token, id, input);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.detail ??
        (result.error === "rationale_required"
          ? "This disposition asserts a judgement, so it needs a reason of at least 10 characters."
          : result.error === "outside_attention_window"
            ? "This engagement is not awaiting analyst triage."
            : `That didn't work (${result.error}).`),
    };
  }
  revalidateEngagement(id);
  return { ok: true, createdFinding: result.created_finding };
}
