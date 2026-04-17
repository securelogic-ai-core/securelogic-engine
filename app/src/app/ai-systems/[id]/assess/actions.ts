"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type UpdateGovernanceAssessmentStatusResult = { error: string };

export async function updateGovernanceAssessmentStatus(
  assessmentId: string,
  status: string,
  overall_severity: string,
  systemId: string
): Promise<UpdateGovernanceAssessmentStatusResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/ai-governance-assessments/${assessmentId}`, {
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

  revalidatePath(`/ai-systems/${systemId}`);
}

export type CreateGovernanceAssessmentResult = { error: string };

export async function createGovernanceAssessment(
  systemId: string,
  formData: FormData
): Promise<CreateGovernanceAssessmentResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  const status = ((formData.get("status") as string | null) ?? "").trim();
  if (!status) return { error: "Status is required" };

  const overall_severity = ((formData.get("overall_severity") as string | null) ?? "").trim() || null;
  const summary = ((formData.get("summary") as string | null) ?? "").trim() || null;
  const notes = ((formData.get("notes") as string | null) ?? "").trim() || null;
  const performed_at = ((formData.get("performed_at") as string | null) ?? "").trim() || null;

  // POST to create the record (no finding created here)
  let postRes: Response;
  try {
    postRes = await fetch(`${ENGINE_URL}/api/ai-governance-assessments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ai_system_id: systemId, summary, notes, performed_at, overall_severity }),
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

  // PATCH to set status — triggers finding creation for non_compliant/partially_compliant
  let patchRes: Response;
  try {
    patchRes = await fetch(`${ENGINE_URL}/api/ai-governance-assessments/${assessmentId}`, {
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
    return { error: data.error ?? "Failed to update assessment status" };
  }

  revalidatePath(`/ai-systems/${systemId}`);
  redirect(`/ai-systems/${systemId}`);
}
