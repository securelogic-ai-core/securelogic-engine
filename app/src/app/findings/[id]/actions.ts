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
  };
}

export async function updateFindingStatusAction(
  findingId: string,
  status: string
): Promise<{ error?: string }> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  try {
    const res = await fetch(`${ENGINE_URL}/api/findings/${findingId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: body.error ?? "Failed to update status" };
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
  decisionState: string
): Promise<{ error?: string }> {
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  try {
    const res = await fetch(`${ENGINE_URL}/api/findings/${findingId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ decision_state: decisionState }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
      // Guarded transitions 409 with a machine reason — surface it in customer
      // language instead of a silent no-op (a control that silently fails is a
      // dead control).
      const REASON_COPY: Record<string, string> = {
        close_requires_remediated_or_accepted_risk:
          "Cannot close: remediation is not complete (or accept the risk first).",
        actor_identity_required:
          "Cannot close: your organization requires an identified user to close findings.",
        separation_of_duties:
          "Cannot close: your organization requires a different person than the remediator to close this finding.",
        invalid_decision_transition: "That decision change is not allowed from the current state.",
      };
      return { error: (body.reason && REASON_COPY[body.reason]) ?? body.error ?? "Failed to update decision" };
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
  const token = await getToken();
  if (!token) return { error: "Not authenticated" };

  try {
    const res = await fetch(`${ENGINE_URL}/api/actions/${actionId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ status }),
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
