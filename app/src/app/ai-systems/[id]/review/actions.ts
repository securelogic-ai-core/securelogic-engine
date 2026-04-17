"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreateGovernanceReviewResult = { error: string };

export async function createGovernanceReview(
  systemId: string,
  formData: FormData
): Promise<CreateGovernanceReviewResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  const review_type = ((formData.get("review_type") as string | null) ?? "").trim();
  if (!review_type) return { error: "Review type is required" };

  const overall_severity = ((formData.get("overall_severity") as string | null) ?? "").trim();
  if (!overall_severity) return { error: "Severity is required" };

  const performed_at = ((formData.get("performed_at") as string | null) ?? "").trim() || new Date().toISOString().slice(0, 10);
  const summary = ((formData.get("summary") as string | null) ?? "").trim() || null;
  const outcome = ((formData.get("outcome") as string | null) ?? "").trim() || null;

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/governance-reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ai_system_id: systemId, review_type, overall_severity, performed_at, summary, outcome }),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: data.error ?? "Failed to create governance review" };
  }

  revalidatePath(`/ai-systems/${systemId}`);
  redirect(`/ai-systems/${systemId}`);
}
