"use server";

/**
 * Governance mutations for the AI-system detail page (AI T2 family).
 *
 * Three write paths, all engine-authoritative:
 *   - declare / retract one of the four typed governance edges
 *     (POST/DELETE /api/ai-system-<kind>-links — aiSystemGovernanceLinks.ts);
 *   - record a formal use decision
 *     (POST /api/ai-systems/:id/use-approvals — aiUseApprovals.ts, append-only:
 *     there is no edit and no delete, a wrong decision is superseded by a new row).
 *
 * The client mirrors the engine's 400 rules for a usable form, but the engine
 * remains the authority — every validation here can be bypassed and the engine
 * still refuses. Same server-action pattern as the sibling dependencyActions.ts:
 * session token → engine fetch → revalidate the surface that renders the result.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  AI_GOVERNANCE_LINK_FAMILIES,
  type AiGovernanceLinkKind,
} from "@/lib/api";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type GovernanceActionResult = { ok: true } | { error: string };

const LINK_ERROR_MESSAGES: Record<string, string> = {
  ai_system_not_found: "This AI system no longer exists.",
  framework_not_found: "That framework no longer exists.",
  control_not_found: "That control no longer exists.",
  policy_not_found: "That policy no longer exists.",
  obligation_not_found: "That obligation no longer exists.",
  link_not_found: "That link no longer exists.",
  contributor_role_forbidden: "Contributors can't change governance links.",
};

export async function addGovernanceLink(
  aiSystemId: string,
  kind: AiGovernanceLinkKind,
  targetId: string
): Promise<GovernanceActionResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  const family = AI_GOVERNANCE_LINK_FAMILIES[kind];
  if (!family) return { error: "Unknown link kind" };
  if (!targetId.trim()) return { error: `Pick a ${kind}.` };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/ai-system-${kind}-links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ai_system_id: aiSystemId,
        [family.targetCol]: targetId,
      }),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: LINK_ERROR_MESSAGES[data.error ?? ""] ?? `Could not link the ${kind}` };
  }

  revalidatePath(`/ai-systems/${aiSystemId}`);
  return { ok: true };
}

export async function removeGovernanceLink(
  aiSystemId: string,
  kind: AiGovernanceLinkKind,
  linkId: string
): Promise<GovernanceActionResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  if (!AI_GOVERNANCE_LINK_FAMILIES[kind]) return { error: "Unknown link kind" };

  let res: Response;
  try {
    res = await fetch(
      `${ENGINE_URL}/api/ai-system-${kind}-links/${encodeURIComponent(linkId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: LINK_ERROR_MESSAGES[data.error ?? ""] ?? `Could not remove the ${kind} link` };
  }

  revalidatePath(`/ai-systems/${aiSystemId}`);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────
// Use decision (append-only)
// ─────────────────────────────────────────────────────────────────────

const DECISION_ERROR_MESSAGES: Record<string, string> = {
  ai_system_not_found: "This AI system no longer exists.",
  invalid_decision: "Pick a decision.",
  rationale_required: "Every use decision must state its grounds.",
  conditions_required: "A conditional approval must state its conditions.",
  conditions_only_on_conditional_approval:
    "Conditions belong only on a conditional approval.",
  expires_at_must_be_iso_date: "The expiry must be a date.",
  expiry_only_on_approval:
    "Only an approval expires — a rejection or suspension stands until superseded.",
  contributor_role_forbidden: "Contributors can't record use decisions.",
};

export async function recordUseDecision(
  aiSystemId: string,
  formData: FormData
): Promise<GovernanceActionResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  const decision = ((formData.get("decision") as string | null) ?? "").trim();
  const rationale = ((formData.get("rationale") as string | null) ?? "").trim();
  const conditions = ((formData.get("conditions") as string | null) ?? "").trim();
  const expiresAt = ((formData.get("expires_at") as string | null) ?? "").trim();
  const assessmentId = ((formData.get("assessment_id") as string | null) ?? "").trim();

  if (!decision) return { error: "Pick a decision." };
  if (!rationale) return { error: "Every use decision must state its grounds." };

  // Mirror the engine's consistency rules so the round-trip is not needed for
  // the common mistakes — but send what the customer typed; the engine decides.
  // assessment_id rides through untouched: the engine owns the same-org,
  // same-system pre-flight (assessment_not_found_for_this_system).
  const body: Record<string, string> = { decision, rationale };
  if (conditions) body["conditions"] = conditions;
  if (expiresAt) body["expires_at"] = expiresAt;
  if (assessmentId) body["assessment_id"] = assessmentId;

  let res: Response;
  try {
    res = await fetch(
      `${ENGINE_URL}/api/ai-systems/${encodeURIComponent(aiSystemId)}/use-approvals`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        cache: "no-store",
      }
    );
  } catch {
    return { error: "Network error — please try again" };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
    };
    return {
      error:
        DECISION_ERROR_MESSAGES[data.error ?? ""] ??
        data.detail ??
        "Could not record the decision",
    };
  }

  revalidatePath(`/ai-systems/${aiSystemId}`);
  return { ok: true };
}
