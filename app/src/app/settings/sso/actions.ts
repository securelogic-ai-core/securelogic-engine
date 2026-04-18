"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

interface SsoConfigInput {
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate: string;
  sp_entity_id: string;
  is_enforced: boolean;
}

export async function saveSsoConfigAction(
  data: SsoConfigInput
): Promise<{ error: string } | void> {
  const session = await getSession();
  const token   = session.jwtToken ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/sso/config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — could not reach engine" };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: body.error ?? "Failed to save SSO configuration" };
  }

  revalidatePath("/settings/sso");
  redirect("/settings/sso");
}

export async function deleteSsoConfigAction(): Promise<{ error: string } | void> {
  const session = await getSession();
  const token   = session.jwtToken ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/sso/config`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — could not reach engine" };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: body.error ?? "Failed to delete SSO configuration" };
  }

  revalidatePath("/settings/sso");
  redirect("/settings/sso");
}
