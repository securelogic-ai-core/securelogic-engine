"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { patchRisk } from "@/lib/api";

/**
 * RR-5 — Server actions for the risk detail page.
 *
 * updateRiskCadenceAction wraps PATCH /api/risks/:id with only the
 * review_cadence_days field. Pass a positive integer to set the
 * per-risk override; pass null to clear it (falls back to org policy).
 *
 * markRiskReviewedAction wraps POST /api/risks/:id/review with optional
 * reviewed_at + note. The engine route computes next_review_due from
 * the effective cadence and emits a `risk.reviewed` audit event.
 *
 * Both actions revalidate /risks/[id] (so the cadence card re-renders
 * with fresh values) and /risks (so the list table picks up overdue
 * badge changes).
 */

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function updateRiskCadenceAction(
  riskId: string,
  reviewCadenceDays: number | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { ok: false, error: "unauthenticated" };

  const result = await patchRisk(token, riskId, {
    review_cadence_days: reviewCadenceDays,
  });
  if ("error" in result) return { ok: false, error: result.error };

  revalidatePath(`/risks/${riskId}`);
  revalidatePath("/risks");
  return { ok: true };
}

export async function markRiskReviewedAction(
  riskId: string,
  body: { reviewed_at?: string | null; note?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { ok: false, error: "unauthenticated" };

  // Build a minimal payload — the engine validates ISO dates and
  // note length (≤500). Empty values are stripped so the engine sees
  // "absent" rather than "explicitly null", keeping the validation
  // path identical to a curl-driven call.
  const payload: Record<string, unknown> = {};
  if (body.reviewed_at && body.reviewed_at.trim().length > 0) {
    payload.reviewed_at = body.reviewed_at.trim();
  }
  if (body.note && body.note.trim().length > 0) {
    payload.note = body.note.trim();
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ENGINE_URL}/api/risks/${encodeURIComponent(riskId)}/review`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      }
    );
  } catch {
    return { ok: false, error: "engine_unavailable" };
  }

  if (!upstream.ok) {
    const errBody = (await upstream.json().catch(() => null)) as
      | { error?: string }
      | null;
    return { ok: false, error: errBody?.error ?? `http_${upstream.status}` };
  }

  revalidatePath(`/risks/${riskId}`);
  revalidatePath("/risks");
  return { ok: true };
}
