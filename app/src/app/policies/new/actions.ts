"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:3001";

export async function createPolicyAction(data: {
  name: string;
  description?: string;
  category?: string;
  version?: string;
  owner?: string;
  status?: string;
  review_frequency?: string | null;
  last_reviewed_at?: string;
  next_review_at?: string;
}): Promise<{ error?: string }> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  try {
    const res = await fetch(`${ENGINE_URL}/api/policies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-api-key": token,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: body.error ?? "Failed to create policy" };
    }
  } catch {
    return { error: "Failed to create policy" };
  }

  redirect("/policies");
}
