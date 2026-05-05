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
