"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

async function getToken(): Promise<string | null> {
  const session = await getSession();
  return session.jwtToken ?? session.apiKey ?? null;
}

function authHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "x-api-key": token,
  };
}

export async function markPolicyReviewed(policyId: string): Promise<void> {
  const token = await getToken();
  if (!token) return;

  await fetch(`${ENGINE_URL}/api/policies/${policyId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({
      status: "active",
      last_reviewed_at: new Date().toISOString().slice(0, 10),
    }),
  });

  revalidatePath(`/policies/${policyId}`);
}

export async function linkControlAction(
  policyId: string,
  controlId: string
): Promise<{ error?: string }> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  try {
    const res = await fetch(`${ENGINE_URL}/api/policies/${policyId}/controls`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ control_id: controlId }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: body.error ?? "Failed to link control" };
    }
  } catch {
    return { error: "Failed to link control" };
  }

  revalidatePath(`/policies/${policyId}`);
  return {};
}

export async function unlinkControlAction(
  policyId: string,
  controlId: string
): Promise<void> {
  const token = await getToken();
  if (!token) return;

  await fetch(`${ENGINE_URL}/api/policies/${policyId}/controls/${controlId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });

  revalidatePath(`/policies/${policyId}`);
}
