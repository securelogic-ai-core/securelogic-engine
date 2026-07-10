"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  acceptSignalMatchSuggestion as engineAccept,
  dismissSignalMatchSuggestion as engineDismiss,
} from "@/lib/api";

export type SuggestionActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Server actions wrapping the engine accept/dismiss endpoints. Used by the
 * matcher queue UI's optimistic-commit timer (see SuggestionList): the user
 * clicks Accept/Dismiss, the row enters a 5s "pending-commit" state, and on
 * timer expiry one of these actions runs.
 *
 * revalidatePath is called for the queue page so a navigation back picks up
 * fresh state. Embedded queue lists on entity detail pages also revalidate
 * via the embeddedRevalidatePath argument.
 */

export async function acceptSuggestionAction(
  suggestionId: string,
  options?: { note?: string | null; embeddedRevalidatePath?: string }
): Promise<SuggestionActionResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { ok: false, error: "Not authenticated" };

  const result = await engineAccept(token, suggestionId, {
    note: options?.note ?? null,
  });
  if ("error" in result) return { ok: false, error: result.error };

  revalidatePath("/queue");
  if (options?.embeddedRevalidatePath) {
    revalidatePath(options.embeddedRevalidatePath);
  }
  return { ok: true };
}

export async function dismissSuggestionAction(
  suggestionId: string,
  options?: { dismissal_reason?: string | null; embeddedRevalidatePath?: string }
): Promise<SuggestionActionResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { ok: false, error: "Not authenticated" };

  const result = await engineDismiss(token, suggestionId, {
    dismissal_reason: options?.dismissal_reason ?? null,
  });
  if ("error" in result) return { ok: false, error: result.error };

  revalidatePath("/queue");
  if (options?.embeddedRevalidatePath) {
    revalidatePath(options.embeddedRevalidatePath);
  }
  return { ok: true };
}

export type BulkDecisionResult = {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
};

/**
 * Bulk accept/dismiss (ERIP §3). Deliberately loops the SAME ratified per-suggestion
 * engine endpoints — no new engine transaction, no partial-transaction semantics to
 * get wrong. Each item is independently org-scoped and atomic engine-side; one bad
 * item never blocks the rest (its error is returned per-id). Sequential to keep
 * FOR-UPDATE contention low. Capped defensively. Revalidates /queue once at the end.
 */
export async function bulkDecideSuggestionsAction(
  ids: string[],
  decision: "accept" | "dismiss",
  options?: { embeddedRevalidatePath?: string }
): Promise<BulkDecisionResult> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { succeeded: [], failed: ids.map((id) => ({ id, error: "Not authenticated" })) };

  const unique = Array.from(new Set(ids)).slice(0, 100);
  const succeeded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const id of unique) {
    const result =
      decision === "accept"
        ? await engineAccept(token, id, { note: null })
        : await engineDismiss(token, id, { dismissal_reason: null });
    if ("error" in result) failed.push({ id, error: result.error });
    else succeeded.push(id);
  }

  revalidatePath("/queue");
  if (options?.embeddedRevalidatePath) revalidatePath(options.embeddedRevalidatePath);
  return { succeeded, failed };
}
