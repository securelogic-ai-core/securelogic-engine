"use server";

/**
 * bulkActions.ts — server actions for POST /api/findings/bulk (W2: the ops
 * center must be operable at scale — 200 unassigned findings cannot mean 200
 * round trips). Guard refusals from the engine come back per-id; this action
 * summarizes them honestly instead of pretending everything applied.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { engineBaseUrl } from "@/lib/engineBaseUrl";

const ENGINE_URL = engineBaseUrl();

export interface BulkResult {
  error?: string;
  updated?: number;
  refused?: number;
  /** First refusal reason (machine code) — enough for an honest toolbar note. */
  refusalReason?: string;
}

async function callBulk(body: Record<string, unknown>): Promise<BulkResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  try {
    const res = await fetch(`${ENGINE_URL}/api/findings/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      updated?: number;
      results?: Array<{ id: string; ok: boolean; reason?: string }>;
    };
    if (!res.ok) return { error: payload.error ?? "Bulk operation failed" };
    const refusedResults = (payload.results ?? []).filter((r) => !r.ok);
    revalidatePath("/findings");
    return {
      updated: payload.updated ?? 0,
      refused: refusedResults.length,
      ...(refusedResults[0]?.reason ? { refusalReason: refusedResults[0].reason } : {}),
    };
  } catch {
    return { error: "Network error" };
  }
}

/** Assign the selected findings to the CURRENT session user. */
export async function bulkAssignToMeAction(ids: string[]): Promise<BulkResult> {
  const session = await getSession();
  if (!session.userId) {
    return { error: "Assign to me requires a signed-in user (not an API key session)." };
  }
  return callBulk({ op: "assign", ids, owner_user_id: session.userId });
}

/** Apply one decision to the selected findings — each individually guarded engine-side. */
export async function bulkDecideAction(ids: string[], decisionState: string): Promise<BulkResult> {
  return callBulk({ op: "decide", ids, decision_state: decisionState });
}
