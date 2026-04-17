"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreateFindingResult = { error: string };

export async function createFinding(
  vendorId: string,
  formData: FormData
): Promise<CreateFindingResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  const title = ((formData.get("title") as string | null) ?? "").trim();
  if (!title) return { error: "Title is required" };

  const severity = ((formData.get("severity") as string | null) ?? "").trim();
  if (!severity) return { error: "Severity is required" };

  const body: Record<string, string | null> = {
    title,
    severity,
    domain: "Vendor Risk",
    source_type: "manual",
    source_id: vendorId,
    description: ((formData.get("description") as string | null) ?? "").trim() || null,
    remediation_notes: ((formData.get("remediation_notes") as string | null) ?? "").trim() || null,
    status: "open",
    priority: ((formData.get("priority") as string | null) ?? "").trim() || null,
  };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/findings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: data.error ?? "Failed to create finding" };
  }

  revalidatePath(`/vendors/${vendorId}`);
  redirect(`/vendors/${vendorId}`);
}
