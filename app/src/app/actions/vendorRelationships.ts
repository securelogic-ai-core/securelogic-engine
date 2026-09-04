"use server";

/**
 * Vendor Onboarding 2.0 relationship server actions. THIN proxies, same shape
 * as the contact actions: session token in, typed wrapper out, revalidate the
 * vendor page. No rules live here — the engine derives the classification and
 * refuses incomplete intake, and its words come back verbatim.
 */
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  createVendorRelationship,
  updateVendorRelationship,
  submitRelationshipIntake,
  createVendorEngagementFromRelationship,
  isVendorRelationshipFailure,
  isEngagementFailure,
  type VendorRelationship,
  type RelationshipIntakeInput,
  type AssessmentTierValue,
} from "@/lib/api";

export type RelationshipActionState =
  | { ok: true; relationship?: VendorRelationship; engagementId?: string }
  | { ok: false; error: string };

const MESSAGES: Record<string, string> = {
  relationship_already_exists: "This vendor already has a relationship with that name.",
  relationship_not_found: "That relationship no longer exists.",
  vendor_not_found: "Vendor was not found for this organization.",
  name_required: "A name is required.",
  incomplete_intake: "Every question must be answered before a classification can be derived.",
  intake_required: "Complete the factual intake first — nothing is classified until the facts are recorded.",
  invalid_policy_minimum_tier: "Choose one of the four assessment tiers.",
  not_found: "Vendor Assurance is not available on this environment yet.",
};
function text(error: string, message?: string, extra?: { missing?: string[]; invalid?: string[] }): string {
  const base = MESSAGES[error] ?? message ?? `That didn't work (${error}).`;
  if (extra?.invalid?.length) return `${base} Not accepted: ${extra.invalid.join(", ")}.`;
  if (extra?.missing?.length) return `${base} Missing: ${extra.missing.join(", ")}.`;
  return base;
}
async function token(): Promise<string | null> {
  const s = await getSession();
  return s.jwtToken ?? s.apiKey ?? null;
}

export async function addVendorRelationship(vendorId: string, input: { name: string; service_description?: string; is_primary?: boolean }): Promise<RelationshipActionState> {
  const t = await token(); if (!t) return { ok: false, error: "Not authenticated" };
  const r = await createVendorRelationship(t, vendorId, input);
  if (isVendorRelationshipFailure(r)) return { ok: false, error: text(r.failure.error, r.failure.message) };
  revalidatePath(`/vendors/${vendorId}`);
  return { ok: true, relationship: r.relationship };
}

export async function setRelationshipPolicy(vendorId: string, relationshipId: string, policy_minimum_tier: AssessmentTierValue | null): Promise<RelationshipActionState> {
  const t = await token(); if (!t) return { ok: false, error: "Not authenticated" };
  const r = await updateVendorRelationship(t, vendorId, relationshipId, { policy_minimum_tier });
  if (isVendorRelationshipFailure(r)) return { ok: false, error: text(r.failure.error, r.failure.message) };
  revalidatePath(`/vendors/${vendorId}`);
  return { ok: true, relationship: r.relationship };
}

export async function recordRelationshipIntake(vendorId: string, relationshipId: string, intake: RelationshipIntakeInput): Promise<RelationshipActionState> {
  const t = await token(); if (!t) return { ok: false, error: "Not authenticated" };
  const r = await submitRelationshipIntake(t, vendorId, relationshipId, intake);
  if (isVendorRelationshipFailure(r)) return { ok: false, error: text(r.failure.error, r.failure.message, r.failure) };
  revalidatePath(`/vendors/${vendorId}`);
  return { ok: true, relationship: r.relationship };
}

export async function openAssessmentForRelationship(vendorId: string, relationshipId: string, title?: string): Promise<RelationshipActionState> {
  const t = await token(); if (!t) return { ok: false, error: "Not authenticated" };
  const r = await createVendorEngagementFromRelationship(t, { vendor_id: vendorId, relationship_id: relationshipId, engagement_type: "initial", ...(title ? { title } : {}) });
  if (isEngagementFailure(r)) return { ok: false, error: text(r.failure.error, r.failure.message) };
  revalidatePath(`/vendors/${vendorId}`);
  return { ok: true, engagementId: r.id };
}
