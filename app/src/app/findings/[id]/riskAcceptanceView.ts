/**
 * riskAcceptanceView.ts — the PURE view model for a finding's risk-acceptance lifecycle.
 *
 * The engine subsystem (/api/risk-acceptances) is the ONE approval workflow for accepting
 * the risk of a Finding — separate from `risk_approvals` (the Risk Register lifecycle).
 * This module turns the acceptance rows the engine returns into honest, customer-facing
 * state: what happened, what remains, and what the viewer can do next. It is I/O-free and
 * DOM-free on purpose, so the whole state machine is unit-testable without a browser.
 *
 * The states mirror the engine's finding_risk_acceptances.state exactly (one definition):
 *   proposed          — signed, awaiting a DIFFERENT authorized user (finding stays Active)
 *   approved          — binding until its review date (finding is closed, stays governed)
 *   rejected          — a proposal a colleague declined (finding stayed Active)
 *   withdrawn         — a live acceptance a human retracted (finding reopened)
 *   expired           — an approved acceptance past its review date (finding reopened)
 *   legacy_unverified — a historical acceptance with no approval evidence
 */

import type { RiskAcceptance, RiskAcceptanceState } from "@/lib/api";

/** The states that occupy a finding's single "live acceptance" slot (engine contract). */
const LIVE_STATES: ReadonlySet<RiskAcceptanceState> = new Set([
  "proposed",
  "approved",
  "legacy_unverified",
]);

export type AcceptanceTone = "pending" | "binding" | "reopened" | "declined" | "legacy";

export type AcceptanceNarrative = {
  label: string;
  tone: AcceptanceTone;
  /** What this state MEANS for the finding right now. */
  what: string;
};

/**
 * Split a finding's acceptances into its single live record (if any) and its terminal
 * history, newest-first. At most one live record can exist — the engine's partial unique
 * index guarantees it — so `live` is a single value, not a list.
 */
export function partitionAcceptances(acceptances: RiskAcceptance[]): {
  live: RiskAcceptance | null;
  history: RiskAcceptance[];
} {
  let live: RiskAcceptance | null = null;
  const history: RiskAcceptance[] = [];
  for (const a of acceptances) {
    if (LIVE_STATES.has(a.state)) {
      // Defensive: if two ever arrived, keep the most recently updated as live and demote
      // the other into history rather than dropping it.
      if (!live) live = a;
      else if (a.updated_at > live.updated_at) {
        history.push(live);
        live = a;
      } else history.push(a);
    } else {
      history.push(a);
    }
  }
  history.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return { live, history };
}

/** Honest one-line meaning for each acceptance state. Never says "closed" for a proposal. */
export function acceptanceNarrative(a: RiskAcceptance): AcceptanceNarrative {
  switch (a.state) {
    case "proposed":
      return {
        label: "Awaiting approval",
        tone: "pending",
        what: "This risk acceptance is proposed and signed, but not yet approved. The finding stays Active until a different authorized user approves it.",
      };
    case "approved":
      return {
        label: "Accepted — binding",
        tone: "binding",
        what: "The risk is accepted and binding. The finding is closed and has left Active Findings and every remediation queue; the exposure stays governed here until its review date.",
      };
    case "rejected":
      return {
        label: "Rejected",
        tone: "declined",
        what: "An approver declined this proposal. The finding was never closed by it and remains Active.",
      };
    case "withdrawn":
      return {
        label: "Withdrawn",
        tone: "reopened",
        what: "This acceptance was withdrawn. The finding was reopened and is Active work again.",
      };
    case "expired":
      return {
        label: "Expired",
        tone: "reopened",
        what: "This acceptance reached its review date and lapsed. The finding was reopened for a fresh decision.",
      };
    case "legacy_unverified":
      return {
        label: "Historical — unverified",
        tone: "legacy",
        what: "A historical acceptance with no recorded approver, rationale or review date. It keeps the finding closed as before, but must be completed by withdrawing it and proposing a new, fully-signed acceptance.",
      };
  }
}

/**
 * Separation of duties, computed for the UI so the control refuses BEFORE the round-trip.
 * The engine enforces it too (belt and suspenders): the requester may never decide their
 * own acceptance. An API-key caller (no user id) also cannot decide.
 */
export function canDecide(live: RiskAcceptance, currentUserId: string | null): boolean {
  if (!currentUserId) return false;
  return live.requested_by_user_id !== currentUserId;
}

/** True once an approved acceptance is inside `days` of its review/expiration date. */
export function isReviewDueSoon(
  a: RiskAcceptance,
  today: Date,
  days = 30
): boolean {
  if (a.state !== "approved" || !a.expires_at) return false;
  const expiry = new Date(`${a.expires_at}T00:00:00Z`);
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + days);
  return expiry <= horizon;
}

/**
 * Engine error code → customer sentence. A guarded refusal (separation of duties, a stale
 * proposal, a legacy record) is a real outcome the person must understand, never a silent
 * no-op. Unmapped codes fall back to the raw code so nothing is swallowed.
 */
export const RISK_ACCEPTANCE_ERROR_COPY: Record<string, string> = {
  // propose
  owner_user_id_required: "Choose the owner who will be accountable for carrying this risk.",
  rationale_required: "Add the rationale for accepting this risk.",
  expires_at_required: "Set a review / expiration date — an acceptance is never permanent.",
  owner_not_in_organization: "The selected owner is not a member of your organization.",
  acceptance_already_live_for_finding:
    "This finding already has a live risk acceptance. Resolve it before proposing another.",
  finding_not_found: "This finding could not be found.",
  // decide
  user_identity_required: "You must be signed in as a user to make this decision.",
  separation_of_duties:
    "You proposed this acceptance — a different authorized user must approve or reject it.",
  acceptance_not_approvable: "This acceptance can no longer be approved.",
  acceptance_not_rejectable: "This acceptance can no longer be rejected.",
  acceptance_not_live: "This acceptance is no longer live.",
  legacy_acceptance_requires_completion:
    "This is a historical acceptance with no approval evidence. Withdraw it (which reopens the finding) and propose a new acceptance with owner, rationale and review date.",
  acceptance_not_found: "This risk acceptance could not be found.",
  // shared
  "Not authenticated": "You are not signed in.",
  "Network error": "Could not reach the server. Try again.",
};

export function riskAcceptanceErrorCopy(code: string | undefined): string {
  if (!code) return "Something went wrong. Try again.";
  return RISK_ACCEPTANCE_ERROR_COPY[code] ?? code;
}
