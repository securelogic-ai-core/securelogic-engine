"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreateReviewResult = { error: string };

export async function createReview(
  vendorId: string,
  formData: FormData
): Promise<CreateReviewResult | void> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  const status = ((formData.get("status") as string | null) ?? "").trim();
  if (!status) return { error: "Status is required" };

  const body: Record<string, string | null> = {
    vendor_id: vendorId,
    status,
    overall_severity: ((formData.get("overall_severity") as string | null) ?? "").trim() || null,
    summary: ((formData.get("summary") as string | null) ?? "").trim() || null,
    notes: ((formData.get("notes") as string | null) ?? "").trim() || null,
    performed_at: ((formData.get("performed_at") as string | null) ?? "").trim() || null,
  };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/vendor-reviews`, {
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
    return { error: data.error ?? "Failed to create review" };
  }

  revalidatePath(`/vendors/${vendorId}`);
  redirect(`/vendors/${vendorId}`);
}
