"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type CreateRiskInput = {
  title: string;
  description: string | null;
  domain: string;
  likelihood: string;
  impact: string;
  risk_rating: string;
  treatment: string | null;
  owner: string | null;
  due_date: string | null;
};

export type CreateRiskResult = { ok: false; error: string };
// Success path redirects via Next.js — never returns to the caller.

/**
 * Server action wrapping POST /api/risks.
 *
 * On success: revalidates /risks and redirects to /risks/{newId}.
 * On error: returns { ok: false, error } so the form can render the
 * server's error code inline.
 *
 * No client-side computation of risk_rating from likelihood × impact.
 * The migration explicitly leaves that to the user; spec item 6
 * carries that decision forward.
 */
export async function createRiskAction(
  input: CreateRiskInput
): Promise<CreateRiskResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { ok: false, error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/risks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "Network error — please try again" };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
    return { ok: false, error: body.detail ?? body.error ?? `create_failed_${res.status}` };
  }

  const data = (await res.json()) as { risk: { id: string } };
  const newRiskId = data.risk?.id;

  revalidatePath("/risks");

  if (!newRiskId) {
    // Shouldn't happen — POST /api/risks returns 201 with the risk row —
    // but handle defensively rather than redirecting to /risks/undefined.
    redirect("/risks");
  }
  redirect(`/risks/${newRiskId}`);
}
