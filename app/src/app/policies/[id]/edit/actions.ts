"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function updatePolicyAction(
  policyId: string,
  data: {
    name?: string;
    description?: string | null;
    category?: string;
    version?: string | null;
    owner?: string | null;
    status?: string;
    review_frequency?: string | null;
    last_reviewed_at?: string | null;
    next_review_at?: string | null;
  }
): Promise<{ error?: string }> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  try {
    const res = await fetch(`${ENGINE_URL}/api/policies/${policyId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-api-key": token,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: body.error ?? "Failed to update policy" };
    }
  } catch {
    return { error: "Failed to update policy" };
  }

  redirect(`/policies/${policyId}`);
}
