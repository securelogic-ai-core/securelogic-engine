/**
 * riskLifecycleStateMachine.ts — Epic R1, the pure transition engine.
 *
 * A pure, I/O-free, fully unit-testable decision function (modelled on
 * app/src/lib/sessionPolicy.ts `evaluateSession`). It takes the current
 * persisted lifecycle state, a requested transition, and a bag of already-
 * resolved gate inputs, and returns a rich decision object. It performs NO
 * database access — the caller resolves gate inputs and applies the result.
 *
 * Authority: docs/specs/risk-lifecycle-spec.md §2 (state machine) and the
 * "Decisions (R1)" addendum. 9 persisted states; the 12 customer-facing stages
 * are a UI projection (owner/evidence/score are gate conditions, not states).
 *
 * Fail-safe: an unrecognised / garbage current state never throws and never
 * allows a transition — it returns { allowed:false, reason:'unknown_state' }.
 */

// ── States ────────────────────────────────────────────────────────────────
export const LIFECYCLE_STATES = [
  "draft",
  "scoping",
  "treatment_selection",
  "pending_approval",
  "mitigation",
  "validation",
  "residual_review",
  "closed",
  "archived",
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

const VALID_STATES = new Set<string>(LIFECYCLE_STATES);
const TERMINAL_STATES = new Set<LifecycleState>(["closed", "archived"]);

// ── Transitions ──────────────────────────────────────────────────────────
export const TRANSITIONS = [
  "begin_assessment",
  "advance_to_treatment",
  "submit_for_approval",
  "start_mitigation_direct",
  "approve",
  "reject",
  "complete_mitigation",
  "pass_validation",
  "fail_validation",
  "close",
  "reopen",
  "archive",
  "unarchive",
  "rescore",
] as const;

export type TransitionName = (typeof TRANSITIONS)[number];

const VALID_TRANSITIONS = new Set<string>(TRANSITIONS);

// ── Gate reasons (machine-readable, surfaced as 409 `reason`) ──────────────
export type GateReason =
  | "owner_required"
  | "evidence_required"
  | "score_required"
  | "treatment_required"
  | "approval_required"
  | "separation_of_duties"
  | "actor_identity_required";

export type DecisionReason =
  | GateReason
  | "invalid_transition"
  | "unknown_state"
  | "terminal_state";

/** Internal gate keys used on edges. `approval_not_required` maps to the
 *  `approval_required` reason when it fails (you may not skip approval). */
type GateKey = GateReason | "approval_not_required";

// ── Edges: `${transition}:${fromState}` → { to, gates (checked in order) } ──
interface Edge {
  to: LifecycleState;
  gates: GateKey[];
}

const EDGES: Record<string, Edge> = {
  // draft → scoping (begin assessment; no gate)
  "begin_assessment:draft": { to: "scoping", gates: [] },

  // scoping → treatment_selection (owner + score required; evidence if enforced)
  "advance_to_treatment:scoping": {
    to: "treatment_selection",
    gates: ["owner_required", "score_required", "evidence_required"],
  },

  // treatment_selection → pending_approval (a treatment must exist)
  "submit_for_approval:treatment_selection": {
    to: "pending_approval",
    gates: ["treatment_required"],
  },

  // treatment_selection → mitigation (only when approval is NOT required for
  // this risk — threshold model; unsatisfiable in R1 because the threshold is
  // NULL ⇒ approval always required)
  "start_mitigation_direct:treatment_selection": {
    to: "mitigation",
    gates: ["treatment_required", "approval_not_required"],
  },

  // pending_approval → mitigation (APPROVE — R2 executes; recognised in R1)
  "approve:pending_approval": {
    to: "mitigation",
    gates: ["actor_identity_required", "separation_of_duties", "approval_required"],
  },

  // pending_approval → treatment_selection (REJECT loop-back — R2)
  "reject:pending_approval": {
    to: "treatment_selection",
    gates: ["actor_identity_required", "separation_of_duties"],
  },

  // mitigation → validation
  "complete_mitigation:mitigation": { to: "validation", gates: [] },

  // validation → residual_review (PASS)
  "pass_validation:validation": { to: "residual_review", gates: [] },

  // validation → mitigation (FAIL loop-back)
  "fail_validation:validation": { to: "mitigation", gates: [] },

  // residual_review → closed (residual must be scored)
  "close:residual_review": { to: "closed", gates: ["score_required"] },

  // closed → residual_review (REOPEN)
  "reopen:closed": { to: "residual_review", gates: [] },

  // → archived (from closed, or directly from residual_review)
  "archive:closed": { to: "archived", gates: [] },
  "archive:residual_review": { to: "archived", gates: [] },

  // archived → closed (UN-ARCHIVE)
  "unarchive:archived": { to: "closed", gates: [] },

  // RESCORE loop-back to scoping on new evidence (from any active post-scoping state)
  "rescore:treatment_selection": { to: "scoping", gates: [] },
  "rescore:pending_approval": { to: "scoping", gates: [] },
  "rescore:mitigation": { to: "scoping", gates: [] },
  "rescore:validation": { to: "scoping", gates: [] },
  "rescore:residual_review": { to: "scoping", gates: [] },
};

// ── Gate inputs (all resolved by the caller; no I/O here) ───────────────────
export interface GateInputs {
  /** risks.owner_user_id IS NOT NULL */
  hasOwner: boolean;
  /** risks.residual_rating IS NOT NULL */
  hasScore: boolean;
  /** ≥1 live evidence record attached to the risk (source_type='risk', R4) */
  hasEvidence: boolean;
  /** org policy risk_settings.require_evidence_gate (default false ⇒ advisory) */
  evidenceGateEnforced: boolean;
  /** count of risk_treatments for the risk */
  treatmentCount: number;
  /** an approved risk_approvals row exists for the risk (R2; false in R1) */
  approvalGranted: boolean;
  /** whether approval is required for this risk (threshold model; true in R1) */
  approvalRequired: boolean;
  /** acting user id — null on the API-key-only path */
  actorUserId: string | null;
  /** proposer of the pending approval, for separation-of-duties (R2; null in R1) */
  proposerUserId: string | null;
}

export interface TransitionDecision {
  allowed: boolean;
  reason?: DecisionReason;
  /** normalised current state (raw null ⇒ 'draft'); absent when unknown_state */
  fromState?: LifecycleState;
  /** target state when allowed */
  toState?: LifecycleState;
}

function normalizeState(raw: string | null | undefined): LifecycleState | undefined {
  if (raw === null || raw === undefined || raw === "") return "draft";
  return VALID_STATES.has(raw) ? (raw as LifecycleState) : undefined;
}

function gateSatisfied(gate: GateKey, g: GateInputs): boolean {
  switch (gate) {
    case "owner_required":
      return g.hasOwner;
    case "score_required":
      return g.hasScore;
    case "evidence_required":
      // Only blocks when the org enforces the evidence gate.
      return !g.evidenceGateEnforced || g.hasEvidence;
    case "treatment_required":
      return g.treatmentCount > 0;
    case "approval_required":
      return g.approvalGranted;
    case "approval_not_required":
      return !g.approvalRequired;
    case "separation_of_duties":
      // Must have an identified actor who is NOT the proposer.
      return g.actorUserId !== null && g.actorUserId !== g.proposerUserId;
    case "actor_identity_required":
      return g.actorUserId !== null;
    default: {
      // Exhaustiveness guard — unknown gate is treated as unsatisfied (fail-safe).
      const _never: never = gate;
      return _never;
    }
  }
}

function gateReason(gate: GateKey): GateReason {
  // `approval_not_required` failing means approval IS required.
  return gate === "approval_not_required" ? "approval_required" : gate;
}

/**
 * Pure transition decision. No I/O. Never throws on bad input.
 */
export function evaluateTransition(
  currentStateRaw: string | null | undefined,
  transition: string,
  gates: GateInputs
): TransitionDecision {
  const current = normalizeState(currentStateRaw);
  if (current === undefined) {
    return { allowed: false, reason: "unknown_state" };
  }

  const edge = EDGES[`${transition}:${current}`];
  if (!edge) {
    // Discriminate: a terminal state with no matching exit is `terminal_state`
    // (only when the transition name is otherwise known); everything else is an
    // invalid transition for this state.
    if (TERMINAL_STATES.has(current) && VALID_TRANSITIONS.has(transition)) {
      return { allowed: false, reason: "terminal_state", fromState: current };
    }
    return { allowed: false, reason: "invalid_transition", fromState: current };
  }

  for (const gate of edge.gates) {
    if (!gateSatisfied(gate, gates)) {
      return { allowed: false, reason: gateReason(gate), fromState: current };
    }
  }

  return { allowed: true, fromState: current, toState: edge.to };
}

/**
 * Legacy `risks.status` sync for a transition (Decisions Q3 / spec §3.5).
 *
 * R1 intentionally touches legacy status ONLY on terminal-ish transitions so it
 * never clobbers a treatment-driven status (mitigated/accepted/transferred) set
 * by the existing treatment→status sync. Full derived-mirror is R2.
 *
 * Returns the status to write, or null to leave `risks.status` untouched.
 */
export function legacyStatusForTransition(
  transition: TransitionName
): "open" | "closed" | null {
  switch (transition) {
    case "close":
    case "archive":
    case "unarchive":
      return "closed";
    case "reopen":
      return "open";
    default:
      return null;
  }
}

/** True when `raw` is a recognised persisted lifecycle state. */
export function isLifecycleState(raw: unknown): raw is LifecycleState {
  return typeof raw === "string" && VALID_STATES.has(raw);
}

/** The state a NULL/unmanaged risk is treated as when the flag is on. */
export const DEFAULT_LIFECYCLE_STATE: LifecycleState = "draft";
