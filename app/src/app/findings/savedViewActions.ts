"use server";

/**
 * savedViewActions.ts — server actions for Findings saved views (ERIP §1). The
 * engine enforces org+user scoping and the DECISION_WORKSPACE flag; these actions
 * only forward the session token. Filters are re-sanitized engine-side.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

async function getToken(): Promise<string | null> {
  const session = await getSession();
  return session.jwtToken ?? session.apiKey ?? null;
}

function authHeaders(token: string): HeadersInit {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export async function saveFindingViewAction(
  name: string,
  filters: Record<string, string>
): Promise<{ error?: string }> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };
  try {
    const res = await fetch(`${ENGINE_URL}/api/finding-saved-views`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ name, filters }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: body.error ?? "Failed to save view" };
    }
  } catch {
    return { error: "Network error" };
  }
  revalidatePath("/findings");
  return {};
}

export async function deleteFindingViewAction(id: string): Promise<{ error?: string }> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };
  try {
    const res = await fetch(`${ENGINE_URL}/api/finding-saved-views/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: body.error ?? "Failed to delete view" };
    }
  } catch {
    return { error: "Network error" };
  }
  revalidatePath("/findings");
  return {};
}
