"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type ObligationEditData = {
  title: string;
  description?: string | null;
  source_regulation?: string | null;
  jurisdiction?: string | null;
  domain?: string | null;
  status?: string;
  priority?: string | null;
  due_date?: string | null;
  notes?: string | null;
};

export async function updateObligationAction(
  id: string,
  data: ObligationEditData
): Promise<{ error: string } | never> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/obligations/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again." };
  }

  if (res.ok) {
    redirect(`/obligations/${id}`);
  }

  const json = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
  return { error: json.detail ?? json.error ?? "Failed to update obligation" };
}
