"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { patchRiskTreatment } from "@/lib/api";

export type TransitionResult = { ok: true } | { ok: false; error: string };

/**
 * transitionTreatmentAction — server action wrapping
 * PATCH /api/risk-treatments/:id with a status transition.
 *
 * The backend validator gates source→target via VALID_TRANSITIONS:
 *   not_started → in_progress
 *   in_progress → mitigated | accepted | transferred
 *   terminal    → (no exit)
 * Self-loops are rejected. The UI only ever sends valid transitions.
 *
 * Terminal transitions atomically update the parent risk's status to
 * match (server-side, single transaction). Multi-treatment edge case:
 * a risk with two open treatments will see the parent risk's status
 * overwritten when ANY treatment transitions to terminal — see the
 * confirmation modal in TreatmentDetailClient.
 *
 * On success: revalidate /risks/:id (treatments list) and the
 * treatment detail page (transition section needs to re-render the new
 * available targets, or the terminal-state notice). Stays on the same
 * page; no redirect.
 */
export async function transitionTreatmentAction(
  riskId: string,
  treatmentId: string,
  targetStatus: "in_progress" | "mitigated" | "accepted" | "transferred"
): Promise<TransitionResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { ok: false, error: "Not authenticated" };

  const result = await patchRiskTreatment(token, treatmentId, {
    status: targetStatus,
  });
  if ("error" in result) return { ok: false, error: result.error };

  revalidatePath(`/risks/${riskId}`);
  revalidatePath(`/risks/${riskId}/treatments/${treatmentId}`);
  revalidatePath("/risks");

  return { ok: true };
}
