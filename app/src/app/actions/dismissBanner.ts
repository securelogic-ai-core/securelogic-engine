"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * Dismiss a per-user banner. Used by IndustryTemplatesBanner with
 * bannerKey = 'industry-templates-banner'. Idempotent server-side
 * (array dedup); calling twice with the same key is a no-op.
 */
export async function dismissBannerAction(
  bannerKey: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { ok: false, error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/me/dismiss-banner`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ banner_key: bannerKey }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "Network error" };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `dismiss_failed_${res.status}` };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
