"use server";

/**
 * briefingLayoutActions.ts — server actions for the Briefing layout (Briefing
 * Initiative B2). The engine enforces org+user scoping, the DASHBOARD_BRIEFING
 * flag, and full envelope validation against ITS generated module manifest;
 * these actions only forward the session token (the savedViewActions pattern).
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import type { BriefingModuleId } from "@/lib/briefing/contracts";
import { envelopeFromModuleIds } from "@/lib/briefing/layout";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

async function getToken(): Promise<string | null> {
  const session = await getSession();
  return session.jwtToken ?? session.apiKey ?? null;
}

function authHeaders(token: string): HeadersInit {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export async function saveBriefingLayoutAction(
  moduleIds: BriefingModuleId[]
): Promise<{ error?: string }> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };
  try {
    const res = await fetch(`${ENGINE_URL}/api/briefing/layout`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ layout: envelopeFromModuleIds(moduleIds) }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: body.error ?? "Failed to save your Briefing layout" };
    }
  } catch {
    return { error: "Network error" };
  }
  revalidatePath("/dashboard");
  return {};
}

/**
 * Bare reset — returns the caller to the UNSAVED state (legacy projection if a
 * legacy preference row still exists, else the live role default; spec ruling
 * C2). The UI's "Restore role default" deliberately uses saveBriefingLayoutAction
 * with the role-default ids instead (an explicit persisted choice).
 */
export async function resetBriefingLayoutAction(): Promise<{ error?: string }> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };
  try {
    const res = await fetch(`${ENGINE_URL}/api/briefing/layout`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: body.error ?? "Failed to reset your Briefing layout" };
    }
  } catch {
    return { error: "Network error" };
  }
  revalidatePath("/dashboard");
  return {};
}
