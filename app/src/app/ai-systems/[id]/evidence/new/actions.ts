"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreateAiSystemEvidenceResult = { error: string };

export async function createAiSystemEvidence(
  systemId: string,
  formData: FormData
): Promise<CreateAiSystemEvidenceResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  const sourceCombo = ((formData.get("source_combo") as string | null) ?? "").trim();
  if (!sourceCombo) return { error: "Please link this evidence to a review or assessment" };

  const parts = sourceCombo.split("::");
  if (parts.length !== 2) return { error: "Invalid source selection" };
  const [source_type, source_id] = parts as [string, string];

  const title = ((formData.get("title") as string | null) ?? "").trim();
  if (!title) return { error: "Title is required" };

  const evidence_type = ((formData.get("evidence_type") as string | null) ?? "").trim();
  if (!evidence_type) return { error: "Evidence type is required" };

  const description = ((formData.get("description") as string | null) ?? "").trim() || null;
  const collected_at = ((formData.get("collected_at") as string | null) ?? "").trim() || null;
  const collected_by = ((formData.get("collected_by") as string | null) ?? "").trim() || null;
  const external_ref = ((formData.get("external_ref") as string | null) ?? "").trim() || null;

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ source_type, source_id, title, evidence_type, description, collected_at, collected_by, external_ref }),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: data.error ?? "Failed to add evidence" };
  }

  revalidatePath(`/ai-systems/${systemId}`);
  redirect(`/ai-systems/${systemId}`);
}
