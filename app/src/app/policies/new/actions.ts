"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createPolicy } from "@/lib/api";

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

  const result = await createPolicy(token, data);
  if (!result) return { error: "Failed to create policy" };

  redirect("/policies");
}
