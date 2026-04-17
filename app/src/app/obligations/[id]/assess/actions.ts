"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

export type TransitionObligationAssessmentResult = { error: string };

export async function transitionObligationAssessment(
  assessmentId: string,
  status: string,
  overall_severity: string,
  obligationId: string
): Promise<TransitionObligationAssessmentResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/obligation-assessments/${assessmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status, overall_severity }),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 409) {
      return { error: data.error ?? "This assessment is already in a terminal state" };
    }
    return { error: data.error ?? "Failed to update assessment" };
  }

  revalidatePath(`/obligations/${obligationId}`);
}

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreateObligationAssessmentResult = { error: string };

export async function createObligationAssessment(
  obligationId: string,
  formData: FormData
): Promise<CreateObligationAssessmentResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  const status = ((formData.get("status") as string | null) ?? "").trim();
  if (!status) return { error: "Status is required" };

  const overall_severity = ((formData.get("overall_severity") as string | null) ?? "").trim();
  if (!overall_severity) return { error: "Overall severity is required" };

  const summary = ((formData.get("summary") as string | null) ?? "").trim() || null;
  const notes = ((formData.get("notes") as string | null) ?? "").trim() || null;
  const performed_at = ((formData.get("performed_at") as string | null) ?? "").trim() || null;

  // POST creates the record in in_progress state (obligation must be active)
  let postRes: Response;
  try {
    postRes = await fetch(`${ENGINE_URL}/api/obligation-assessments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        obligation_id: obligationId,
        summary,
        notes,
        performed_at,
        overall_severity,
      }),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!postRes.ok) {
    const data = (await postRes.json().catch(() => ({}))) as { error?: string };
    return { error: data.error ?? "Failed to create assessment" };
  }

  const postBody = (await postRes.json()) as { assessment?: { id: string } };
  const assessmentId = postBody.assessment?.id;

  if (!assessmentId) return { error: "Assessment created but ID not returned" };

  // PATCH to set terminal status (creates finding for non_compliant/partially_compliant)
  let patchRes: Response;
  try {
    patchRes = await fetch(`${ENGINE_URL}/api/obligation-assessments/${assessmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status, overall_severity, summary, notes, performed_at }),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error updating assessment status" };
  }

  if (!patchRes.ok) {
    const data = (await patchRes.json().catch(() => ({}))) as { error?: string };
    // 409 means terminal state or invalid transition — surface it clearly
    if (patchRes.status === 409) {
      return { error: data.error ?? "This assessment is already in a terminal state" };
    }
    return { error: data.error ?? "Failed to update assessment status" };
  }

  revalidatePath(`/obligations/${obligationId}`);
  redirect(`/obligations/${obligationId}`);
}
