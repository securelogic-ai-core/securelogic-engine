"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * The form-facing input shape — package
 * risk-register-inherent-residual-rating Phase 3, Decision §6.
 *
 * The user fills 6 rating inputs (3 inherent + 3 residual). The
 * legacy likelihood/impact/risk_rating fields are NOT exposed in
 * the form. This action constructs the legacy values automatically
 * by mirroring residual_* into legacy on the wire (Path (i) from
 * the Phase 3 spec contradiction resolution): the Phase 2 POST
 * validator still requires all 9 rating fields, so we send all 9.
 *
 * Net behavior: POST handler then writes legacy = (what we sent =
 * residual). Same end state as if the validator had been relaxed
 * to make legacy optional and auto-fill from residual. Zero
 * backend changes; the assumption is documented in the create
 * form so future readers know the legacy fields aren't omitted by
 * accident.
 */
export type CreateRiskInput = {
  title: string;
  description: string | null;
  domain: string;
  // 6 user-facing rating fields per Decision §6.
  inherent_likelihood: string;
  inherent_impact: string;
  inherent_rating: string;
  residual_likelihood: string;
  residual_impact: string;
  residual_rating: string;
  treatment: string | null;
  owner: string | null;
  due_date: string | null;
};

export type CreateRiskResult = { ok: false; error: string };
// Success path redirects via Next.js — never returns to the caller.

export async function createRiskAction(
  input: CreateRiskInput
): Promise<CreateRiskResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { ok: false, error: "Not authenticated" };

  // Mirror residual into legacy at the wire (Path (i) — see header
  // comment). The validator still requires all 9 rating fields; we
  // populate the legacy 3 from residual_* so the form stays at 6
  // user-facing inputs without a backend relaxation.
  const wireBody = {
    title:               input.title,
    description:         input.description,
    domain:              input.domain,
    likelihood:          input.residual_likelihood,
    impact:              input.residual_impact,
    risk_rating:         input.residual_rating,
    inherent_likelihood: input.inherent_likelihood,
    inherent_impact:     input.inherent_impact,
    inherent_rating:     input.inherent_rating,
    residual_likelihood: input.residual_likelihood,
    residual_impact:     input.residual_impact,
    residual_rating:     input.residual_rating,
    treatment:           input.treatment,
    owner:               input.owner,
    due_date:            input.due_date,
  };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/risks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(wireBody),
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
