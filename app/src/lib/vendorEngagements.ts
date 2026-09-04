/**
 * vendorEngagements.ts — pure UI-side domain helpers for the internal
 * Vendor Assurance engagement workflow (/vendor-engagements).
 *
 * MIRRORS (never re-invents) the engine's single authority on workflow
 * legality: src/api/lib/vendorRisk/engagementStateMachine.ts. The engine
 * remains the enforcer — every transition is re-checked server-side and a
 * refused one comes back as a 409 whose reason the UI must surface. These
 * helpers exist so the UI only OFFERS actions the machine would allow, and can
 * explain, for each unavailable action, what has to happen first.
 *
 * Plain dependency-free data + predicates (no React, no Next) so the queue,
 * the workspace, and the unit tests all read the same definitions.
 */

export const ENGAGEMENT_STATES = [
  "draft",
  "scoping",
  "scoped",
  "issued",
  "in_progress",
  "submitted",
  "in_review",
  "clarification_requested",
  "analysis_complete",
  "decision_pending",
  "decided",
  "monitoring",
  "closed",
  "cancelled",
  "expired",
] as const;
export type EngagementState = (typeof ENGAGEMENT_STATES)[number];

export function isEngagementState(v: string | null | undefined): v is EngagementState {
  return v !== null && v !== undefined && (ENGAGEMENT_STATES as readonly string[]).includes(v);
}

export const ENGAGEMENT_STATE_LABELS: Record<EngagementState, string> = {
  draft: "Draft",
  scoping: "Scoping",
  scoped: "Scoped",
  issued: "Issued",
  in_progress: "Vendor responding",
  submitted: "Submitted",
  in_review: "In review",
  clarification_requested: "Clarification requested",
  analysis_complete: "Analysis complete",
  decision_pending: "Decision pending",
  decided: "Decided",
  monitoring: "Monitoring",
  closed: "Closed",
  cancelled: "Cancelled",
  expired: "Expired",
};

/** Terminal states — nothing leaves these; every action panel renders read-only. */
export const TERMINAL_ENGAGEMENT_STATES: readonly EngagementState[] = [
  "closed",
  "cancelled",
  "expired",
];
export function isTerminal(state: EngagementState): boolean {
  return TERMINAL_ENGAGEMENT_STATES.includes(state);
}

// ── Per-action availability (mirror of the engine's transition table) ─────────

/** Scope and tier freeze at `issued`; inherent is overridable on the same window. */
const SCOPE_MUTABLE: readonly EngagementState[] = ["draft", "scoping", "scoped"];

export function canOverrideInherent(state: EngagementState): boolean {
  return SCOPE_MUTABLE.includes(state);
}
export function canResolveScope(state: EngagementState): boolean {
  return SCOPE_MUTABLE.includes(state);
}
/** `scoped → issued` is the only issue transition the machine permits. */
export function canIssue(state: EngagementState): boolean {
  return state === "scoped";
}
export function canBeginReview(state: EngagementState): boolean {
  return state === "submitted";
}
export function canCompleteAnalysis(state: EngagementState): boolean {
  return state === "in_review";
}
/**
 * The engine's /recompute has no state gate beyond "inherent computed", but the
 * measurement is only meaningful once a response exists to measure. Offered
 * from review onward; from `analysis_complete` it is also the step that
 * advances the machine to `decision_pending`.
 */
export function canRecompute(state: EngagementState): boolean {
  return [
    "in_review",
    "clarification_requested",
    "analysis_complete",
    "decision_pending",
    "decided",
    "monitoring",
  ].includes(state);
}
export function canDecide(state: EngagementState): boolean {
  return state === "decision_pending";
}
export function canStartMonitoring(state: EngagementState): boolean {
  return state === "decided";
}
export function canRefreshMonitoring(state: EngagementState): boolean {
  return state === "monitoring";
}
/**
 * Promotion needs assessed controls to promote; the engine itself only
 * requires an inherent rating, but offering it before a response exists would
 * promote a wall of not_assessed gaps nobody has reviewed yet.
 */
export function canPromoteFindings(state: EngagementState): boolean {
  return [
    "in_review",
    "clarification_requested",
    "analysis_complete",
    "decision_pending",
    "decided",
    "monitoring",
  ].includes(state);
}
/**
 * The clarification thread accepts internal notes in any non-terminal state
 * (the engine's POST has no state gate). A VENDOR-VISIBLE message posted while
 * `in_review` performs in_review → clarification_requested.
 */
export function canComment(state: EngagementState): boolean {
  return !isTerminal(state);
}

// ── "Why is this disabled?" — every locked action explains itself ─────────────

export type EngagementAction =
  | "override_inherent"
  | "resolve_scope"
  | "issue"
  | "begin_review"
  | "complete_analysis"
  | "recompute"
  | "decide"
  | "start_monitoring"
  | "promote_findings";

const ACTION_AVAILABLE: Record<EngagementAction, (s: EngagementState) => boolean> = {
  override_inherent: canOverrideInherent,
  resolve_scope: canResolveScope,
  issue: canIssue,
  begin_review: canBeginReview,
  complete_analysis: canCompleteAnalysis,
  recompute: canRecompute,
  decide: canDecide,
  start_monitoring: (s) => canStartMonitoring(s) || canRefreshMonitoring(s),
  promote_findings: canPromoteFindings,
};

export function isActionAvailable(action: EngagementAction, state: EngagementState): boolean {
  return ACTION_AVAILABLE[action](state);
}

/**
 * The explanation shown beside a disabled action: what must happen first.
 * Returns null when the action is available.
 */
export function actionUnavailableReason(
  action: EngagementAction,
  state: EngagementState
): string | null {
  if (isActionAvailable(action, state)) return null;
  if (isTerminal(state)) {
    return `This engagement is ${ENGAGEMENT_STATE_LABELS[state].toLowerCase()} — no further workflow actions apply.`;
  }
  switch (action) {
    case "override_inherent":
      return "Inherent risk is locked once the questionnaire has been issued — the assessment tier and the frozen scope derive from it.";
    case "resolve_scope":
      return "The questionnaire has been issued. Its scope is frozen — a vendor's answers are only meaningful against the questions they were asked. A scope change requires a new engagement.";
    case "issue":
      if (state === "draft" || state === "scoping") {
        return "Resolve the questionnaire scope first — that is what makes an engagement issuable.";
      }
      return "The questionnaire has already been issued to the vendor.";
    case "begin_review":
      if (["draft", "scoping", "scoped", "issued", "in_progress"].includes(state)) {
        return "Review opens once the vendor submits their response.";
      }
      return "Review has already been opened for this engagement.";
    case "complete_analysis":
      if (state === "clarification_requested") {
        return "A clarification is out with the vendor. Analysis completes from In review.";
      }
      if (["submitted"].includes(state)) {
        return "Begin the review first — completing analysis records that a reviewer has been through the response.";
      }
      if (["draft", "scoping", "scoped", "issued", "in_progress"].includes(state)) {
        return "Available once the vendor has submitted and the review has begun.";
      }
      return "Analysis has already been completed for this engagement.";
    case "recompute":
      return "Effectiveness and residual risk are computed from the vendor's response — available once review has begun.";
    case "decide":
      if (state === "decided" || state === "monitoring") {
        return "A decision has already been recorded for this engagement.";
      }
      return "A decision needs a computed residual risk: complete the analysis, then run the risk recompute to reach Decision pending.";
    case "start_monitoring":
      return "Monitoring starts after a decision has been recorded.";
    case "promote_findings":
      return "Findings promote from an assessed response — available once review has begun.";
  }
}

// ── Analysis coverage: honest rendering, ratified ─────────────────────────────

export type AnalysisCoverage = "full" | "partial" | "deterministic_only";

export type AnalysisCoverageCopy = {
  label: string;
  detail: string;
  /** "warn" must never render like a clean pass. */
  tone: "ok" | "warn";
};

/**
 * `deterministic_only` must NEVER read as a clean pass: it means no attached
 * evidence file was read by automated analysis at all.
 */
export function analysisCoverageCopy(coverage: AnalysisCoverage): AnalysisCoverageCopy {
  switch (coverage) {
    case "full":
      return {
        label: "Full analysis",
        detail: "Every attached evidence file was read by automated analysis.",
        tone: "ok",
      };
    case "partial":
      return {
        label: "Partial analysis",
        detail:
          "Some attached evidence was read by automated analysis and some was not. Unanalysed files must be read by a human.",
        tone: "warn",
      };
    case "deterministic_only":
      return {
        label: "No AI analysis ran",
        detail:
          "Only deterministic checks ran — no attached evidence file was read by automated analysis. This is not a clean pass: every file must be reviewed by a human.",
        tone: "warn",
      };
  }
}

// ── Monitoring dates ──────────────────────────────────────────────────────────

/** Today as the DATE string the engine's next_review_due uses (YYYY-MM-DD, UTC). */
export function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * DATE-level comparison, matching the engine sweep's CURRENT_DATE semantics —
 * a review due today is NOT overdue. `today` is injectable for tests.
 */
export function isReviewOverdue(
  nextReviewDue: string | null | undefined,
  today: string = todayISODate()
): boolean {
  if (!nextReviewDue) return false;
  return nextReviewDue.slice(0, 10) < today;
}

// ── Ratings ───────────────────────────────────────────────────────────────────

export const RISK_BANDS = ["Low", "Moderate", "High", "Critical"] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

/** Display colors for the four bands (dark-surface palette shared by the VA screens). */
export function bandColors(band: string | null | undefined): {
  fg: string;
  bg: string;
  border: string;
} {
  switch (band) {
    case "Critical":
      return { fg: "#fca5a5", bg: "rgba(127,29,29,0.25)", border: "#b91c1c" };
    case "High":
      return { fg: "#fdba74", bg: "rgba(154,52,18,0.25)", border: "#c2410c" };
    case "Moderate":
      return { fg: "#fcd34d", bg: "rgba(161,98,7,0.2)", border: "#a16207" };
    case "Low":
      return { fg: "#86efac", bg: "rgba(22,101,52,0.2)", border: "#166534" };
    default:
      return { fg: "#9ca3af", bg: "rgba(31,41,55,0.6)", border: "#374151" };
  }
}

// ── Portal invite URL ─────────────────────────────────────────────────────────

/**
 * The vendor-facing landing for a minted invite token: /portal/accept/[token]
 * (app/src/app/portal/accept/[token]/page.tsx). Built client-side from
 * window.location.origin at display time; the raw token is shown exactly once
 * and never persisted anywhere in the app.
 */
export function portalInviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/portal/accept/${encodeURIComponent(token)}`;
}

// ── Invitation composition (goal §B) ─────────────────────────────────────────

function formatDueDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * The professional default invitation the customer reviews and may edit.
 * MIRRORS `defaultInviteMessage` in the engine (src/api/lib/vendorPortal/
 * inviteEmail.ts): the engine falls back to the same text when a message is
 * omitted, so what the customer previews is what SecureLogic would send.
 * Keep the two in step.
 */
export function defaultInvitationMessage(args: {
  contactName: string | null;
  organizationName: string;
  vendorName: string;
  dueDate?: string | null;
}): string {
  const greeting = args.contactName ? `Hello ${args.contactName.split(" ")[0]},` : "Hello,";
  const due = args.dueDate ? ` We would appreciate your response by ${formatDueDate(args.dueDate)}.` : "";
  return (
    `${greeting}\n\n` +
    `${args.organizationName} assesses the security and governance posture of its vendors, and ` +
    `${args.vendorName} has been selected for an assessment. SecureLogic AI has assembled a ` +
    `questionnaire tailored to the service you provide us; it asks only what applies to this ` +
    `relationship, and you can attach supporting evidence where it helps.${due}\n\n` +
    `Please use the secure link below to open the questionnaire. If someone else at ` +
    `${args.vendorName} is better placed to respond, please let us know.\n\n` +
    `Thank you,\n${args.organizationName}`
  );
}
