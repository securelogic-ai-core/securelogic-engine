"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { patchRisk } from "@/lib/api";

export type EditRiskResult = { ok: false; error: string };
// Success path redirects via Next.js — never returns to the caller.

export type EditRiskInput = Partial<{
  title: string;
  description: string | null;
  domain: string;
  // Inherent (pre-controls) — package
  // risk-register-inherent-residual-rating Phase 3. The edit form
  // exposes these explicitly; the legacy fields below are no longer
  // user-editable on the form.
  inherent_likelihood: string;
  inherent_impact: string;
  inherent_rating: string;
  // Residual (post-controls) — explicitly editable on the form.
  // Phase 2's PATCH handler mirrors residual into the legacy
  // likelihood/impact/risk_rating columns automatically when
  // residual changes (and the legacy field wasn't supplied),
  // preserving webhook payload backwards compatibility.
  residual_likelihood: string;
  residual_impact: string;
  residual_rating: string;
  status: string;
  treatment: string | null;
  owner: string | null;
  owner_user_id: string | null;
  due_date: string | null;
  source_type: string | null;
  source_id: string | null;
}>;

/**
 * editRiskAction — server action wrapping PATCH /api/risks/:id.
 *
 * The form sends only fields that changed (computed in the client by
 * comparing against the original value). Empty diff = short-circuit
 * (the server would reject with no_fields_to_update; we save the
 * round-trip).
 *
 * On success: revalidate /risks/:id (so the detail page re-renders
 * the new values) and /risks (the list table caches updated_at), then
 * redirect to /risks/:id. On error: return { ok: false, error } so the
 * form can render the message inline.
 */
export async function editRiskAction(
  riskId: string,
  changedFields: EditRiskInput
): Promise<EditRiskResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { ok: false, error: "Not authenticated" };

  if (Object.keys(changedFields).length === 0) {
    // No-op submission. Treat as success; redirect back to detail.
    redirect(`/risks/${riskId}`);
  }

  const result = await patchRisk(token, riskId, changedFields);
  if ("error" in result) return { ok: false, error: result.error };

  revalidatePath(`/risks/${riskId}`);
  revalidatePath("/risks");
  redirect(`/risks/${riskId}`);
}
