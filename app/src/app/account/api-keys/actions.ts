"use server";

import { getSession } from "@/lib/session";
import type { ApiKeyRecord } from "@/lib/api";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function createKeyAction(
  label: string
): Promise<{ rawKey: string; key: ApiKeyRecord } | { error: string }> {
  const session = await getSession();
  const token   = session.jwtToken ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/customer/keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label }),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — could not reach engine" };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: body.error ?? "Failed to create API key" };
  }

  const data = (await res.json()) as { rawKey: string; key: ApiKeyRecord };
  return { rawKey: data.rawKey, key: data.key };
}

export async function revokeKeyAction(
  keyId: string
): Promise<{ ok: boolean } | { error: string }> {
  const session = await getSession();
  const token   = session.jwtToken ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(
      `${ENGINE_URL}/api/customer/keys/${encodeURIComponent(keyId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
  } catch {
    return { error: "Network error — could not reach engine" };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
    return { error: body.detail ?? body.error ?? "Failed to revoke API key" };
  }

  return { ok: true };
}
