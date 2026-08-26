"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type AiSystemEditData = {
  name: string;
  use_case?: string | null;
  model_type?: string | null;
  data_classification?: string | null;
  deployment_status?: string | null;
  criticality?: string | null;
  risk_classification?: string | null;
  // ── Governance enrichment (T2-C) — closed vocabularies; the engine validates
  // against the one declaration the migration CHECKs mirror. null clears.
  eu_ai_act_tier?: string | null;
  human_oversight_level?: string | null;
  /** null = never declared; [] = declared "none". The form distinguishes them. */
  sensitive_data_categories?: string[] | null;
  business_owner_user_id?: string | null;
  review_cadence_days?: number | null;
  next_review_due?: string | null;
};

export async function updateAiSystemAction(
  id: string,
  data: AiSystemEditData
): Promise<{ error: string } | never> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  const body: Record<string, string | number | string[] | null> = { name: data.name };
  body.use_case            = data.use_case            ?? null;
  body.model_type          = data.model_type          ?? null;
  body.data_classification = data.data_classification ?? null;
  body.deployment_status   = data.deployment_status   ?? null;
  body.criticality         = data.criticality         ?? null;
  body.risk_classification = data.risk_classification ?? null;
  body.eu_ai_act_tier            = data.eu_ai_act_tier            ?? null;
  body.human_oversight_level     = data.human_oversight_level     ?? null;
  body.sensitive_data_categories = data.sensitive_data_categories ?? null;
  body.business_owner_user_id    = data.business_owner_user_id    ?? null;
  body.review_cadence_days       = data.review_cadence_days       ?? null;
  body.next_review_due           = data.next_review_due           ?? null;

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/ai-systems/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again." };
  }

  if (res.ok) {
    redirect(`/ai-systems/${id}`);
  }

  const json = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
  return { error: json.detail ?? json.error ?? "Failed to update AI system" };
}

export async function deleteAiSystemAction(
  id: string
): Promise<{ error: string; details?: unknown } | never> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/ai-systems/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again." };
  }

  if (res.ok) {
    redirect("/ai-systems");
  }

  const json = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
  if (res.status === 409) {
    return { error: "has_reviews", details: json.details };
  }
  return { error: json.error ?? "Failed to delete AI system" };
}
