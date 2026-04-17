"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

export type UpdateControlAssessmentStatusResult = { error: string };

export async function updateControlAssessmentStatus(
  assessmentId: string,
  status: string,
  overall_severity: string,
  controlId: string
): Promise<UpdateControlAssessmentStatusResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/control-assessments/${assessmentId}`, {
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
    return { error: data.error ?? "Failed to update assessment" };
  }

  revalidatePath(`/controls/${controlId}`);
}

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreateControlAssessmentResult = { error: string };

export async function createControlAssessment(
  controlId: string,
  formData: FormData
): Promise<CreateControlAssessmentResult | void> {
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

  // POST to create the record
  let postRes: Response;
  try {
    postRes = await fetch(`${ENGINE_URL}/api/control-assessments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ control_id: controlId, summary, notes, performed_at, overall_severity }),
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

  // PATCH to set status (and trigger finding creation for failed/remediation_required)
  let patchRes: Response;
  try {
    patchRes = await fetch(`${ENGINE_URL}/api/control-assessments/${assessmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status, overall_severity }),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error updating assessment status" };
  }

  if (!patchRes.ok) {
    const data = (await patchRes.json().catch(() => ({}))) as { error?: string };
    return { error: data.error ?? "Failed to update assessment status" };
  }

  revalidatePath(`/controls/${controlId}`);
  redirect(`/controls/${controlId}`);
}
