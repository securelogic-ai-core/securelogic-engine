/**
 * engagementStateMachine.ts — the ONE place engagement workflow legality is
 * decided.
 *
 * PURE: a table plus two predicates. No I/O. Route handlers ask this module
 * whether a transition is legal and who may cause it; they never hand-roll a
 * status comparison, because that is how a workflow acquires two disagreeing
 * definitions of "can this be submitted".
 *
 * ── The authorization invariant ─────────────────────────────────────────────
 *
 * An EXTERNAL portal session may cause exactly THREE transitions:
 *
 *     issued                  → in_progress
 *     in_progress             → submitted
 *     clarification_requested → in_progress
 *
 * No others, ever. That is a single testable statement and the adversarial
 * suite asserts every other transition is refused from a portal session. It is
 * expressed here as data (`actors` on each transition) rather than as a check
 * scattered through the portal routes, so a new transition cannot accidentally
 * become reachable from outside by omission.
 *
 * ── Scope immutability ──────────────────────────────────────────────────────
 *
 * Scope freezes at `issued`. Changing scope afterwards requires a NEW engagement
 * with a parent_engagement_id — that is the property that makes an engagement
 * auditable, because the questionnaire a vendor answered can never be rewritten
 * underneath their answers.
 *
 * Inherent risk is overridable only BEFORE `issued` for the same reason: the
 * assessment tier derives from it and the scope derives from the tier, so a
 * post-issue change would leave the frozen scope derived from a superseded
 * value with nothing to signal the divergence.
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

/** Who may cause a transition. */
export type TransitionActor = "internal" | "portal" | "system";

export type Transition = {
  from: EngagementState;
  to: EngagementState;
  actors: TransitionActor[];
  /** Named preconditions the route must satisfy before calling. */
  guards: string[];
  description: string;
};

/**
 * The transition table. Anything not listed here is illegal.
 *
 * `guards` are advisory identifiers the route layer enforces — they are named
 * here so the legal shape of the workflow is readable in one place, and so a
 * test can assert that a guard nobody enforces has not been quietly dropped.
 */
export const TRANSITIONS: Transition[] = [
  {
    from: "draft",
    to: "scoping",
    actors: ["internal"],
    guards: ["vendor_set", "engagement_type_set"],
    description: "Begin scoping once the vendor and engagement type are chosen.",
  },
  {
    from: "scoping",
    to: "scoped",
    actors: ["internal"],
    guards: ["inherent_computed", "at_least_one_scope_item"],
    description: "Inherent risk computed and the requirement set resolved.",
  },
  {
    from: "scoped",
    to: "issued",
    actors: ["internal"],
    guards: ["at_least_one_live_invite", "freeze_scope"],
    description:
      "Issue to the vendor. SCOPE AND TIER FREEZE HERE — a later change requires a new engagement.",
  },
  {
    from: "issued",
    to: "in_progress",
    actors: ["portal", "internal"],
    guards: [],
    description: "The vendor opened the questionnaire (first portal session exchange).",
  },
  {
    from: "in_progress",
    to: "submitted",
    actors: ["portal", "internal"],
    guards: ["all_mandatory_answered"],
    description: "The vendor submitted. Portal writes are refused after this point.",
  },
  {
    from: "submitted",
    to: "in_review",
    actors: ["internal"],
    guards: [],
    description: "An internal reviewer opened the response.",
  },
  {
    from: "in_review",
    to: "clarification_requested",
    actors: ["internal"],
    guards: ["clarification_recorded"],
    description: "The reviewer asked the vendor for clarification.",
  },
  {
    from: "clarification_requested",
    to: "in_progress",
    actors: ["portal", "internal"],
    guards: [],
    description: "The vendor reopened the questionnaire to answer a clarification.",
  },
  {
    from: "in_review",
    to: "analysis_complete",
    actors: ["internal"],
    guards: ["analysis_coverage_stamped"],
    description:
      "Review finished. analysis_coverage records whether AI-dependent analysis actually ran.",
  },
  {
    from: "analysis_complete",
    to: "decision_pending",
    actors: ["internal", "system"],
    guards: ["residual_computed"],
    description: "Residual risk computed; the engagement is ready for a human decision.",
  },
  {
    from: "decision_pending",
    to: "decided",
    actors: ["internal"],
    guards: [
      "decision_set",
      "decision_rationale_present",
      "critical_and_high_suggestions_resolved",
      "conditions_have_due_dates",
    ],
    description: "A human recorded the decision with rationale. Never machine-set.",
  },
  {
    from: "decided",
    to: "monitoring",
    actors: ["internal", "system"],
    guards: ["next_review_due_set"],
    description: "Continuous monitoring begins.",
  },
  {
    from: "monitoring",
    to: "closed",
    actors: ["internal"],
    guards: [],
    description: "The relationship ended or the engagement was superseded.",
  },
];

/** Pre-decision states from which an engagement may be cancelled or expired. */
const SIDE_EXIT_FROM: EngagementState[] = [
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
];

const SIDE_EXITS: Transition[] = SIDE_EXIT_FROM.flatMap((from) => [
  {
    from,
    to: "cancelled" as EngagementState,
    actors: ["internal"] as TransitionActor[],
    guards: ["cancellation_reason_present"],
    description: "Cancelled before a decision was reached.",
  },
  {
    from,
    to: "expired" as EngagementState,
    actors: ["system"] as TransitionActor[],
    guards: [],
    description: "The engagement window lapsed without a response.",
  },
]);

export const ALL_TRANSITIONS: Transition[] = [...TRANSITIONS, ...SIDE_EXITS];

/** Terminal states — nothing leaves these. */
export const TERMINAL_STATES: EngagementState[] = ["closed", "cancelled", "expired"];

export function findTransition(
  from: EngagementState,
  to: EngagementState
): Transition | null {
  return ALL_TRANSITIONS.find((t) => t.from === from && t.to === to) ?? null;
}

export type TransitionCheck =
  | { allowed: true; transition: Transition }
  | { allowed: false; reason: "illegal_transition" | "actor_not_permitted" };

/**
 * The single legality check. Fails CLOSED: an unknown pair is illegal, and an
 * actor not explicitly listed is refused.
 */
export function canTransition(
  from: EngagementState,
  to: EngagementState,
  actor: TransitionActor
): TransitionCheck {
  const transition = findTransition(from, to);
  if (!transition) return { allowed: false, reason: "illegal_transition" };
  if (!transition.actors.includes(actor)) {
    return { allowed: false, reason: "actor_not_permitted" };
  }
  return { allowed: true, transition };
}

/** Every transition an external portal session may cause. Exactly three. */
export function portalPermittedTransitions(): Transition[] {
  return ALL_TRANSITIONS.filter((t) => t.actors.includes("portal"));
}

/** Scope and tier are immutable from `issued` onward. */
const SCOPE_MUTABLE_STATES: EngagementState[] = ["draft", "scoping", "scoped"];
export function isScopeMutable(state: EngagementState): boolean {
  return SCOPE_MUTABLE_STATES.includes(state);
}

/**
 * Inherent risk may be overridden only before issue — the tier derives from it
 * and the frozen scope derives from the tier.
 */
export function isInherentOverridable(state: EngagementState): boolean {
  return SCOPE_MUTABLE_STATES.includes(state);
}

/** Portal writes (answers, evidence) are refused once submitted. */
const PORTAL_WRITABLE_STATES: EngagementState[] = ["issued", "in_progress"];
export function isPortalWritable(state: EngagementState): boolean {
  return PORTAL_WRITABLE_STATES.includes(state);
}

/**
 * States in which the vendor may still CHANGE their submission.
 *
 * This is `isPortalWritable` plus `clarification_requested`, and the difference
 * matters: the transition table permits `clarification_requested -> in_progress`
 * by a portal actor, but `isPortalWritable` excludes that state — so a reviewer
 * who asked for clarification produced an engagement the vendor could see and
 * could not act on. The transition was unreachable and the request was a dead
 * end.
 *
 * Answering while in `clarification_requested` is what CAUSES that transition;
 * the route performs it on the first write. It is kept separate from
 * `isPortalWritable` rather than folded into it because the two questions differ:
 * "may the vendor edit?" is not "is this engagement in its initial response
 * window?", and callers that mean the latter (progress display, reminder
 * scheduling) must not silently acquire the former.
 */
const PORTAL_RESPONDABLE_STATES: EngagementState[] = [
  ...PORTAL_WRITABLE_STATES,
  "clarification_requested",
];
export function isPortalRespondable(state: EngagementState): boolean {
  return PORTAL_RESPONDABLE_STATES.includes(state);
}

/**
 * States in which the clarification thread accepts messages.
 *
 * Wider than the write window on purpose: the reviewer's questions arrive DURING
 * review, after the questionnaire has locked, and a thread the vendor cannot
 * reply to is not a thread. It stops at `analysis_complete` — past that point the
 * assessment is concluded and a late message would arrive with nobody obliged to
 * read it, which is worse than a closed thread that says so.
 */
const PORTAL_COMMENTABLE_STATES: EngagementState[] = [
  "issued",
  "in_progress",
  "submitted",
  "in_review",
  "clarification_requested",
];
export function isPortalCommentable(state: EngagementState): boolean {
  return PORTAL_COMMENTABLE_STATES.includes(state);
}
