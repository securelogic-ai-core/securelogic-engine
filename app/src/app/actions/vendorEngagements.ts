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
  revokeVendorEngagementInvite,
  reissueVendorEngagementInvite,
  recomputeVendorEngagementRisk,
  recordVendorEngagementDecision,
  reviewVendorEngagementEvidence,
  promoteVendorEngagementFindings,
  postVendorEngagementComment,
  beginVendorEngagementReview,
  completeVendorEngagementAnalysis,
  startVendorEngagementMonitoring,
  isEngagementFailure,
  vendorEngagementFailureText,
  type VendorEngagementIntakeInput,
  type VendorEngagementDecision,
  type VendorEngagementPromotionResult,
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
 * Issues the engagement and passes the RAW invite token through for its
 * one-time display. Never logged, never persisted here — the engine keeps only
 * the SHA-256, so this return value is the only time anyone sees it.
 */
export async function issueEngagement(
  id: string,
  contactEmail: string,
  contactName?: string
): Promise<
  | { ok: true; inviteToken: string; expiresAt: string; emailDelivery: string }
  | { ok: false; error: string }
> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await issueVendorEngagement(token, id, contactEmail, contactName);
  if (isEngagementFailure(result)) {
    return { ok: false, error: vendorEngagementFailureText(result.failure) };
  }
  revalidateEngagement(id);
  return {
    ok: true,
    inviteToken: result.invite_token,
    expiresAt: result.expires_at,
    // Older engines omit the field; "disabled" is the honest reading — no
    // email left the building.
    emailDelivery: result.email_delivery ?? "disabled",
  };
}

/** VA-L1: kill the link. Access is revoked; history is preserved. */
export async function revokeInvite(
  id: string,
  reason?: string
): Promise<{ ok: true; sessionsRevoked: number } | { ok: false; error: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await revokeVendorEngagementInvite(token, id, reason);
  if (isEngagementFailure(result)) {
    return { ok: false, error: vendorEngagementFailureText(result.failure) };
  }
  revalidateEngagement(id);
  return { ok: true, sessionsRevoked: result.sessions_revoked };
}

/**
 * VA-L1: mint a replacement link (the resend path — only a hash survives
 * issuance, so resending IS re-minting). The prior link and its live sessions
 * die; the new RAW token passes through once, same contract as issue.
 */
export async function reissueInvite(
  id: string,
  contactEmail: string,
  contactName?: string
): Promise<
  | { ok: true; inviteToken: string; expiresAt: string; emailDelivery: string }
  | { ok: false; error: string }
> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Not authenticated" };
  const result = await reissueVendorEngagementInvite(token, id, contactEmail, contactName);
  if (isEngagementFailure(result)) {
    return { ok: false, error: vendorEngagementFailureText(result.failure) };
  }
  revalidateEngagement(id);
  return {
    ok: true,
    inviteToken: result.invite_token,
    expiresAt: result.expires_at,
    emailDelivery: result.email_delivery,
  };
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
