"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreateControlEvidenceResult = { error: string };

export async function createControlEvidence(
  controlId: string,
  formData: FormData
): Promise<CreateControlEvidenceResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  const source_id = ((formData.get("source_id") as string | null) ?? "").trim();
  if (!source_id) return { error: "Assessment is required" };

  const title = ((formData.get("title") as string | null) ?? "").trim();
  if (!title) return { error: "Title is required" };

  const evidence_type = ((formData.get("evidence_type") as string | null) ?? "").trim();
  if (!evidence_type) return { error: "Evidence type is required" };

  const body: Record<string, string | null> = {
    source_type: "control_test",
    source_id,
    title,
    evidence_type,
    description: ((formData.get("description") as string | null) ?? "").trim() || null,
    collected_at: ((formData.get("collected_at") as string | null) ?? "").trim() || null,
    collected_by: ((formData.get("collected_by") as string | null) ?? "").trim() || null,
    external_ref: ((formData.get("external_ref") as string | null) ?? "").trim() || null,
  };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: data.error ?? "Failed to create evidence" };
  }

  revalidatePath(`/controls/${controlId}`);
  redirect(`/controls/${controlId}`);
}
