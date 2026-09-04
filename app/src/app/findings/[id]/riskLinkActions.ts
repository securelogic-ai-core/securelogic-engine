"use server";

/**
 * riskLinkActions.ts — attach a finding to the Risk Register, or promote it
 * into a new entry (SL-RISK-LINK).
 *
 *   link    → POST   /api/findings/:id/risk-links            { risk_id }
 *   unlink  → DELETE /api/findings/:id/risk-links/:riskId
 *   promote → POST   /api/findings/:id/promote-to-risk       { rating trios }
 *
 * There is no client-side decision here and no second Risk Register. The engine
 * owns the relationship, the validation and the audit trail; these actions
 * carry the request and turn a refusal into language a customer can act on.
 *
 * Promotion deliberately requires the person to supply the ratings. The engine
 * defaults only the clerical fields (title, domain) from the finding, and would
 * reject a promotion without a likelihood and impact — a register rating nobody
 * can be named for is a rating nobody will defend.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { engineBaseUrl } from "@/lib/engineBaseUrl";

const ENGINE_URL = engineBaseUrl();

async function getToken(): Promise<string | null> {
  const session = await getSession();
  return session.jwtToken ?? session.apiKey ?? null;
}

/** Engine error codes → what the customer should understand and do. */
export async function riskLinkErrorCopy(code: string | undefined): Promise<string> {
  switch (code) {
    case "risk_not_found":
      return "That risk is no longer in your register.";
    case "finding_not_found":
      return "That finding is no longer available.";
    case "link_not_found":
      return "That link has already been removed.";
    case "risk_id_required":
      return "Choose a risk to link this finding to.";
    case "title_required":
    case "domain_required":
      return "A title and domain are required to create a register entry.";
    case "likelihood_required":
    case "impact_required":
    case "risk_rating_required":
    case "inherent_likelihood_required":
    case "inherent_impact_required":
    case "inherent_rating_required":
    case "residual_likelihood_required":
    case "residual_impact_required":
    case "residual_rating_required":
      return "Rate the risk before adding it to the register — inherent, current and residual.";
    case undefined:
      return "";
    default:
      return "That didn't work. Please try again.";
  }
}

async function call(
  method: "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>
): Promise<{ error?: string }> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };
  try {
    const res = await fetch(`${ENGINE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: await riskLinkErrorCopy(data.error) };
    }
    return {};
  } catch {
    return { error: "Could not reach the service. Please try again." };
  }
}

export async function linkFindingToRisk(
  findingId: string,
  riskId: string,
  note?: string
): Promise<{ error?: string }> {
  const result = await call("POST", `/api/findings/${findingId}/risk-links`, {
    risk_id: riskId,
    ...(note ? { note } : {}),
  });
  if (!result.error) {
    revalidatePath(`/findings/${findingId}`);
    revalidatePath(`/risks/${riskId}`);
  }
  return result;
}

export async function unlinkFindingFromRisk(
  findingId: string,
  riskId: string
): Promise<{ error?: string }> {
  const result = await call("DELETE", `/api/findings/${findingId}/risk-links/${riskId}`);
  if (!result.error) {
    revalidatePath(`/findings/${findingId}`);
    revalidatePath(`/risks/${riskId}`);
  }
  return result;
}

export async function promoteFindingToRisk(
  findingId: string,
  rating: Record<string, unknown>
): Promise<{ error?: string }> {
  const result = await call("POST", `/api/findings/${findingId}/promote-to-risk`, rating);
  if (!result.error) {
    revalidatePath(`/findings/${findingId}`);
    revalidatePath("/risks");
  }
  return result;
}
