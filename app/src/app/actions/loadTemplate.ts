"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type LoadTemplateResult =
  | {
      ok: true;
      industry_id: string;
      inserted: { vendors: number; ai_systems: number; obligations: number; controls: number };
      skipped:  { vendors: number; ai_systems: number; obligations: number; controls: number };
    }
  | { ok: false; error: string };

/**
 * Server action wrapping POST /api/templates/load.
 *
 * On success, revalidates every page that consumes the loaded inventory
 * so a navigation back picks up the new rows. The set is deliberately
 * narrow — /vendors, /ai-systems, /obligations, /controls — plus
 * /queue (the matcher will eventually want to suggest links against
 * the new inventory).
 */
export async function loadTemplateAction(
  industryId: "healthcare-saas" | "fintech" | "b2b-ai",
  selectedItemIds?: string[]
): Promise<LoadTemplateResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { ok: false, error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/templates/load`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        industry_id: industryId,
        ...(selectedItemIds !== undefined ? { selected_item_ids: selectedItemIds } : {}),
      }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "Network error — please try again" };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `load_failed_${res.status}` };
  }

  const data = (await res.json()) as {
    industry_id: string;
    inserted: { vendors: number; ai_systems: number; obligations: number; controls: number };
    skipped:  { vendors: number; ai_systems: number; obligations: number; controls: number };
  };

  revalidatePath("/vendors");
  revalidatePath("/ai-systems");
  revalidatePath("/obligations");
  revalidatePath("/controls");
  revalidatePath("/queue");
  revalidatePath("/dashboard");

  return { ok: true, ...data };
}
