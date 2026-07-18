"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  CLOSE_REQUIRES_REMEDIATION_COMPLETE,
  mapFindingActionError,
  remediationHref,
  type FindingActionError,
} from "@/lib/findingClosureError";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

async function getToken(): Promise<string | null> {
  const session = await getSession();
  return session.jwtToken ?? session.apiKey ?? null;
}

function authHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function updateFindingStatusAction(
  findingId: string,
  status: string
): Promise<FindingActionError | Record<string, never>> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  try {
    const res = await fetch(`${ENGINE_URL}/api/findings/${findingId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      // Closure can be REFUSED (409 close_requires_remediation_complete). Map it to
      // something a human can act on — with the count and a link to the work — instead of
      // putting a raw error code on screen.
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        open_actions?: number;
      };
      return mapFindingActionError(body, findingId, "Failed to update status");
    }
  } catch {
    return { error: "Network error" };
  }

  revalidatePath(`/findings/${findingId}`);
  return {};
}

export async function updateFindingPriorityAction(
  findingId: string,
  priority: string
): Promise<{ error?: string }> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  try {
    const res = await fetch(`${ENGINE_URL}/api/findings/${findingId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ priority }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: body.error ?? "Failed to update priority" };
    }
  } catch {
    return { error: "Network error" };
  }

  revalidatePath(`/findings/${findingId}`);
  return {};
}

export async function updateFindingDueDateAction(
  findingId: string,
  dueDate: string | null
): Promise<{ error?: string }> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  try {
    const res = await fetch(`${ENGINE_URL}/api/findings/${findingId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ due_date: dueDate }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: body.error ?? "Failed to update due date" };
    }
  } catch {
    return { error: "Network error" };
  }

  revalidatePath(`/findings/${findingId}`);
  return {};
}

export async function createRemediationAction(
  findingId: string,
  data: {
    title: string;
    description?: string;
    priority: string;
    due_date?: string;
    // POST /api/actions has always accepted owner_user_id (actions.ts:96,114); the
    // form never sent it, so every action was born unassigned. Assigning at creation
    // is the natural moment — it is when you know who is doing the work.
    owner_user_id?: string | null;
  }
): Promise<{ error?: string }> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  try {
    const res = await fetch(`${ENGINE_URL}/api/actions`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        title: data.title,
        description: data.description,
        priority: data.priority,
        due_date: data.due_date,
        owner_user_id: data.owner_user_id || undefined,
        source_type: "finding",
        source_id: findingId,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: body.error ?? "Failed to create action" };
    }
  } catch {
    return { error: "Network error" };
  }

  revalidatePath(`/findings/${findingId}`);
  return {};
}

// ERIP Package 3 (Decision Workspace) — the BUSINESS DECISION, distinct from the
// operational status. Flag-gated on the engine; a no-op error when dark.
export async function updateFindingDecisionStateAction(
  findingId: string,
  decisionState: string,
  // Optional rationale recorded WITH the transition (lifecycle event comment +
  // audit payload). The Governance Decision panel requires it for closing
  // decisions; the Zone A quick dropdown and bulk ops send none — both remain
  // valid callers of the same engine contract.
  decisionNote?: string
): Promise<FindingActionError | Record<string, never>> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  const note = decisionNote?.trim();
  try {
    const res = await fetch(`${ENGINE_URL}/api/findings/${findingId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({
        decision_state: decisionState,
        ...(note ? { decision_note: note } : {}),
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        reason?: string;
        open_actions?: number;
      };

      // With the closure gate on, the governance axis answers a remediation refusal with
      // the SAME canonical body as the legacy axis — code + count. One rule, one message,
      // one link to the work, whichever axis the customer happened to use.
      if (body.error === CLOSE_REQUIRES_REMEDIATION_COMPLETE) {
        return mapFindingActionError(body, findingId, "Failed to update decision");
      }

      // P0 (2026-07-15): with the signed workflow live, the engine 409s a direct write to
      // accepted_risk. The dropdown already hides that option, so this is defence-in-depth
      // (a stale client / direct call) — surface the engine's customer-safe message.
      if (body.error === "use_risk_acceptance_workflow") {
        return {
          error:
            (body as { message?: string }).message ??
            "Accepting a risk is a governed decision. Propose a risk acceptance and have a different authorized user approve it.",
        };
      }

      // The other guarded transitions 409 with a machine reason — surface it in customer
      // language instead of a silent no-op (a control that silently fails is a dead
      // control).
      const REASON_COPY: Record<string, string> = {
        close_requires_remediated_or_accepted_risk:
          "Complete the remaining required remediation before closing this Finding.",
        actor_identity_required:
          "Cannot close: your organization requires an identified user to close findings.",
        separation_of_duties:
          "Cannot close: your organization requires a different person than the remediator to close this finding.",
        invalid_decision_transition: "That decision change is not allowed from the current state.",
      };
      if (body.reason && REASON_COPY[body.reason]) {
        return {
          error: REASON_COPY[body.reason]!,
          ...(body.reason === "close_requires_remediated_or_accepted_risk"
            ? { remediationHref: remediationHref(findingId) }
            : {}),
        };
      }
      return mapFindingActionError(body, findingId, "Failed to update decision");
    }
  } catch {
    return { error: "Network error" };
  }

  revalidatePath(`/findings/${findingId}`);
  return {};
}

// Records the current user's "last reviewed" marker so the What's-Changed zone
// shows changes since their previous visit.
export async function markFindingReviewedAction(findingId: string): Promise<{ error?: string }> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  try {
    const res = await fetch(`${ENGINE_URL}/api/findings/${findingId}/review`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: body.error ?? "Failed to mark reviewed" };
    }
  } catch {
    return { error: "Network error" };
  }

  revalidatePath(`/findings/${findingId}`);
  return {};
}

export async function updateActionStatusAction(
  findingId: string,
  actionId: string,
  status: string
): Promise<{ error?: string }> {
  return updateActionAction(findingId, actionId, { status });
}

/**
 * Update any field of a remediation action the engine already accepts.
 *
 * PATCH /api/actions/:id has been `updatable: ["status","priority","owner_user_id",
 * "due_date"]` since 20260410 (routes/actions.ts:545), but the UI only ever sent
 * `{status}`. That is what made the Remediation tab a dead end: you could Start a
 * piece of work, but you could not say WHO was doing it, HOW urgent it was, or WHEN
 * it was due — and you could not change your mind after creating it. The work item
 * existed; the plan around it did not.
 *
 * No new model, no new route — the capability was already there, unexposed.
 */
export async function updateActionAction(
  findingId: string,
  actionId: string,
  patch: {
    status?: string;
    priority?: string;
    owner_user_id?: string | null;
    due_date?: string | null;
    // R-10 structured blocker metadata (set when blocking an action).
    blocked_reason?: string | null;
    blocked_dependency?: string | null;
    blocked_owner_user_id?: string | null;
    blocked_expected_unblock_date?: string | null;
  }
): Promise<{ error?: string }> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  try {
    const res = await fetch(`${ENGINE_URL}/api/actions/${actionId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: body.error ?? "Failed to update action" };
    }
  } catch {
    return { error: "Network error" };
  }

  revalidatePath(`/findings/${findingId}`);
  return {};
}

/**
 * Assign the FINDING itself to an owner. PATCH /api/findings/:id has accepted
 * owner_user_id since 20260410 (routes/findings.ts:1170), but the only way to set
 * it was a bulk operation from the list view that assigned to yourself. From the
 * finding you were actually looking at, ownership was read-only text.
 */
export async function assignFindingOwnerAction(
  findingId: string,
  ownerUserId: string | null
): Promise<{ error?: string }> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  try {
    const res = await fetch(`${ENGINE_URL}/api/findings/${findingId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ owner_user_id: ownerUserId }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: body.error ?? "Failed to assign owner" };
    }
  } catch {
    return { error: "Network error" };
  }

  revalidatePath(`/findings/${findingId}`);
  return {};
}
