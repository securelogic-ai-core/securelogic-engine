"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreateReviewResult = { error: string };

export type CompleteReviewResult =
  | { success: true; findingCreated: boolean }
  | { error: string };

export async function completeReview(
  reviewId: string,
  vendorId: string,
  formData: FormData
): Promise<CompleteReviewResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  const status = ((formData.get("completion_status") as string | null) ?? "").trim();
  if (!status) return { error: "Status is required" };

  const summary = ((formData.get("completion_summary") as string | null) ?? "").trim();
  if (!summary) return { error: "Summary is required" };

  const notes = ((formData.get("completion_notes") as string | null) ?? "").trim() || null;
  const overall_severity =
    ((formData.get("completion_severity") as string | null) ?? "").trim() || null;

  const body: Record<string, string | null> = { status, summary, notes, overall_severity };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/vendor-reviews/${reviewId}`, {
      method: "PATCH",
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
    return { error: data.error ?? "Failed to complete review" };
  }

  const data = (await res.json()) as { review: unknown; finding: unknown | null };
  revalidatePath(`/vendors/${vendorId}`);
  return { success: true, findingCreated: data.finding !== null };
}

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
