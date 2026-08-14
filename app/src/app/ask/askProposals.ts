/**
 * askProposals.ts — pure client-side pieces of the ASK-B proposal flow (LC-5).
 *
 * Dependency-free so the repo-root vitest run can prove them without a
 * browser (the voiceGovernance.ts pattern).
 *
 * The confirmation TOKEN never leaves the in-memory answer object: it is not
 * persisted, not logged, and rendered nowhere — these helpers deal only in
 * display state derived AFTER the token has been spent.
 */

import type { AskConfirmResult } from "@/lib/api";

export type ProposalOutcome = {
  tone: "success" | "warning" | "muted" | "error";
  text: string;
};

/**
 * Map a confirm/decline result to what the card should say. Every branch is
 * honest about single-use: a refused execution is refused for good — the user
 * must ask again, not retry the same card.
 */
export function describeProposalOutcome(result: AskConfirmResult): ProposalOutcome {
  if (!result.ok) {
    if (result.status === 404) {
      return {
        tone: "muted",
        text: "This proposal is no longer confirmable — it may have expired. Ask again to get a fresh one.",
      };
    }
    if (result.status === 401) {
      return { tone: "error", text: "Your session has expired. Sign in and ask again." };
    }
    return { tone: "error", text: result.message || "Confirmation failed. Ask again to retry." };
  }
  switch (result.status) {
    case "executed":
      return { tone: "success", text: "Done — the change has been applied." };
    case "refused":
      return {
        tone: "warning",
        text: result.message || "The platform declined this change under your current access.",
      };
    case "declined":
      return { tone: "muted", text: "Discarded — nothing was changed." };
  }
}

/** True when the proposal's confirm window has passed (client-side hint only —
 *  the server enforces expiry regardless of what renders). */
export function proposalExpired(expiresAt: string, now: Date = new Date()): boolean {
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) ? t <= now.getTime() : false;
}
