"use server";

/**
 * riskAcceptanceActions.ts — the customer-facing risk-acceptance lifecycle, wired to the
 * engine's finding risk-acceptance subsystem (NOT a second approval engine).
 *
 *   propose  → POST /api/findings/:id/risk-acceptance   (owner, rationale, review date)
 *   approve  → POST /api/risk-acceptances/:id/approve    (a DIFFERENT user; closes finding)
 *   reject   → POST /api/risk-acceptances/:id/reject     (finding stays Active)
 *   withdraw → POST /api/risk-acceptances/:id/withdraw   (reopens the finding)
 *
 * Separation of duties, the WORM record, expiry and reopen all live in the engine. These
 * actions only carry the request and translate a guarded refusal into customer language.
 * Every route 404s while the feature is dark, so a dark-flag call surfaces as a mapped
 * error, never a silent state change.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { riskAcceptanceErrorCopy } from "./riskAcceptanceView";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

async function getToken(): Promise<string | null> {
  const session = await getSession();
  return session.jwtToken ?? session.apiKey ?? null;
}

function authHeaders(token: string): HeadersInit {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function post(
  path: string,
  body: Record<string, unknown>
): Promise<{ error?: string }> {
  const token = await getToken();
  if (!token) return { error: riskAcceptanceErrorCopy("Not authenticated") };
  try {
    const res = await fetch(`${ENGINE_URL}${path}`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const parsed = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: riskAcceptanceErrorCopy(parsed.error) };
    }
  } catch {
    return { error: riskAcceptanceErrorCopy("Network error") };
  }
  return {};
}

export async function proposeRiskAcceptanceAction(
  findingId: string,
  input: { owner_user_id: string; rationale: string; expires_at: string }
): Promise<{ error?: string }> {
  const r = await post(`/api/findings/${findingId}/risk-acceptance`, {
    owner_user_id: input.owner_user_id,
    rationale: input.rationale,
    expires_at: input.expires_at,
  });
  if (!r.error) revalidatePath(`/findings/${findingId}`);
  return r;
}

export async function approveRiskAcceptanceAction(
  findingId: string,
  acceptanceId: string,
  input: { decision_rationale?: string }
): Promise<{ error?: string }> {
  const r = await post(`/api/risk-acceptances/${acceptanceId}/approve`, {
    decision_rationale: input.decision_rationale,
  });
  if (!r.error) revalidatePath(`/findings/${findingId}`);
  return r;
}

export async function rejectRiskAcceptanceAction(
  findingId: string,
  acceptanceId: string,
  input: { decision_rationale?: string }
): Promise<{ error?: string }> {
  const r = await post(`/api/risk-acceptances/${acceptanceId}/reject`, {
    decision_rationale: input.decision_rationale,
  });
  if (!r.error) revalidatePath(`/findings/${findingId}`);
  return r;
}

export async function withdrawRiskAcceptanceAction(
  findingId: string,
  acceptanceId: string,
  input: { reason?: string }
): Promise<{ error?: string }> {
  const r = await post(`/api/risk-acceptances/${acceptanceId}/withdraw`, {
    reason: input.reason,
  });
  if (!r.error) revalidatePath(`/findings/${findingId}`);
  return r;
}

/**
 * Attach supporting evidence to a risk acceptance. Reuses the generic evidence primitive
 * with source_type='finding_risk_acceptance' (already allowed by the engine's
 * evidenceValidation) — NOT a new evidence store. The engine verifies the acceptance row
 * belongs to the caller's org before writing, so a foreign acceptance id 404s.
 */
export async function attachRiskAcceptanceEvidenceAction(
  findingId: string,
  acceptanceId: string,
  input: { title: string; evidence_type: string; external_ref?: string; description?: string }
): Promise<{ error?: string }> {
  const title = input.title.trim();
  if (!title) return { error: "A title is required." };
  const blankToNull = (v: string | undefined) => {
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  };
  const r = await post(`/api/evidence`, {
    source_type: "finding_risk_acceptance",
    source_id: acceptanceId,
    title,
    evidence_type: input.evidence_type,
    external_ref: blankToNull(input.external_ref),
    description: blankToNull(input.description),
  });
  if (!r.error) revalidatePath(`/findings/${findingId}`);
  return r;
}
