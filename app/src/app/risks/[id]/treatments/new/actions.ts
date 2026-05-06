"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createRiskTreatment } from "@/lib/api";

export type CreateTreatmentResult = { ok: false; error: string };
// Success path redirects via Next.js — never returns to the caller.

export type CreateTreatmentInput = {
  treatment_type: string | null;
  owner: string | null;
  owner_user_id: string | null;
  due_date: string | null;
  summary: string | null;
  notes: string | null;
};

/**
 * createTreatmentAction — server action wrapping POST /api/risk-treatments.
 *
 * The status field is FIXED to 'not_started' here, not user-editable.
 * The backend validator allows other values, but creating a treatment
 * directly in a terminal status would produce an incoherent
 * parent-child state (the parent risk would not auto-sync because the
 * sync logic only runs on PATCH). v1 UI prevents this by hardcoding.
 *
 * On success: revalidate /risks/:id (the detail page's treatments
 * list needs the new entry), then redirect to the new treatment's
 * detail page.
 */
export async function createTreatmentAction(
  riskId: string,
  input: CreateTreatmentInput
): Promise<CreateTreatmentResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { ok: false, error: "Not authenticated" };

  const result = await createRiskTreatment(token, {
    risk_id: riskId,
    status: "not_started",
    treatment_type: input.treatment_type,
    owner: input.owner,
    owner_user_id: input.owner_user_id,
    due_date: input.due_date,
    summary: input.summary,
    notes: input.notes,
  });
  if ("error" in result) return { ok: false, error: result.error };

  const newTreatmentId = result.treatment.id;

  revalidatePath(`/risks/${riskId}`);
  revalidatePath("/risks");

  redirect(`/risks/${riskId}/treatments/${newTreatmentId}`);
}
