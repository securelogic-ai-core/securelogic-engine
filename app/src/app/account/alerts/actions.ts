"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { updateAlertPreferences, type AlertPreferences } from "@/lib/api";

export async function saveAlertPreferences(
  updates: Partial<AlertPreferences>
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { ok: false, error: "unauthenticated" };

  const result = await updateAlertPreferences(token, updates);
  if (!result) return { ok: false, error: "update_failed" };

  revalidatePath("/account/alerts");
  return { ok: true };
}
