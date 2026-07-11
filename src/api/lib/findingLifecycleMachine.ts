/**
 * findingLifecycleMachine.ts — the PURE Finding two-axis lifecycle machine (C6).
 *
 * Authority: docs/specs/finding-lifecycle-spec.md (RATIFIED 2026-07-10).
 * Modelled on riskLifecycleStateMachine.ts (pure decision core) plus the
 * in-transaction event-stream write pattern of riskLifecycle.ts.
 *
 * Two orthogonal axes, single writer each (spec §1, §7):
 *
 *   operational_status — SYSTEM-DERIVED from linked Actions. Never hand-set.
 *     `recomputeFindingOperationalStatus` is the ONLY writer; it runs inside
 *     the caller's asTenant() transaction (the ambient pg routes to the tenant
 *     client), so the Action write and the parent recompute are atomic (§5).
 *
 *   decision_state — HUMAN-GOVERNED. `evaluateFindingDecisionTransition` is
 *     the pure guard (spec §4); the PATCH route applies it. The system never
 *     writes decision_state except the initial value on creation (R3).
 *
 * Every state change writes one finding_lifecycle_events row IN the same
 * transaction (the audit stream, spec §6.2) plus the fire-and-forget
 * security_audit_log projection via the caller.
 */

// ── Operational axis (spec §1.1) ────────────────────────────────────────────

export const OPERATIONAL_STATUSES = ["open", "in_progress", "remediated"] as const;
export type FindingOperationalStatus = (typeof OPERATIONAL_STATUSES)[number];

/** Action statuses that mean "work is underway". */
const ACTION_ACTIVE = new Set(["in_progress", "blocked"]);
/** Action statuses that mean "this work item is finished". */
const ACTION_TERMINAL = new Set(["closed", "accepted"]);

/**
 * Pure derivation (spec §1.1): operational_status is a function of the linked
 * Actions' statuses and the org's evidence-gate policy, nothing else.
 *
 *   in_progress — ≥1 linked Action is in_progress/blocked
 *   remediated  — every linked Action is terminal (closed/accepted) and ≥1
 *                 existed, AND the evidence gate is satisfied if org-enforced
 *   open        — otherwise (no Actions, or none started)
 *
 * Evidence gate (spec §1.1 — the same org policy the Risk lifecycle enforces
 * via risk_settings.require_evidence_gate): when the org enforces the gate,
 * completed work WITHOUT attached evidence stays `in_progress` — for a
 * gate-enforcing org the evidence IS part of the remediation, and validation
 * (ready-for-decision) must not be offered without it. Omitting `gate` (or
 * enforced=false) preserves the action-only derivation.
 */
export interface EvidenceGate {
  /** org policy: risk_settings.require_evidence_gate (default false) */
  enforced: boolean;
  /** ≥1 evidence record with source_type='finding' for this finding */
  hasEvidence: boolean;
}

export function deriveOperationalStatus(
  actionStatuses: readonly string[],
  gate?: EvidenceGate
): FindingOperationalStatus {
  if (actionStatuses.some((s) => ACTION_ACTIVE.has(s))) return "in_progress";
  if (actionStatuses.length > 0 && actionStatuses.every((s) => ACTION_TERMINAL.has(s))) {
    if (gate?.enforced && !gate.hasEvidence) return "in_progress";
    return "remediated";
  }
  return "open";
}

/** Audit event name for an operational change (spec §4 audit column). */
export function operationalAuditEvent(
  from: string,
  to: FindingOperationalStatus
): { eventType: string; transition: string } {
  if (to === "remediated") {
    return { eventType: "finding.remediated", transition: "operational_remediated" };
  }
  if (from === "open" && to === "in_progress") {
    return { eventType: "finding.operational.advanced", transition: "operational_advanced" };
  }
  return { eventType: "finding.operational.recomputed", transition: "operational_recomputed" };
}

// ── Decision axis (spec §1.2, §4) ───────────────────────────────────────────

export const DECISION_STATES = [
  "needs_review",
  "mitigating",
  "accepted_risk",
  "resolved",
] as const;
export type FindingDecisionState = (typeof DECISION_STATES)[number];

const VALID_DECISION = new Set<string>(DECISION_STATES);

export type DecisionTransitionReason =
  | "unknown_state"
  | "invalid_decision_state"
  | "invalid_decision_transition"
  | "close_requires_remediated_or_accepted_risk"
  | "actor_identity_required"
  | "separation_of_duties";

export interface DecisionTransitionDecision {
  allowed: boolean;
  /** true when target === current (idempotent no-op; nothing to write) */
  noop?: boolean;
  reason?: DecisionTransitionReason;
  fromState?: FindingDecisionState;
  toState?: FindingDecisionState;
  /** finding_lifecycle_events.transition + security_audit_log event name */
  transition?: "accept_plan" | "accept_risk" | "close" | "reopen";
  auditEvent?: string;
}

/**
 * Separation-of-duties inputs for the close transition (spec §7 — "separation-
 * of-duties where the Risk lifecycle requires it"; mirrors the Risk machine's
 * gate exactly: actor must be identified and must differ from the counterparty).
 * For findings, the counterparty is the actor who completed the remediation —
 * the actor of the most recent operational→remediated lifecycle event. When
 * that actor is unknown (system/API-key remediation), an identified human may
 * still close — the same null-counterparty semantics as the Risk machine's
 * proposer gate.
 */
export interface ClosureSodGate {
  /** org policy: risk_settings.require_finding_closure_sod (default false) */
  enforced: boolean;
  /** the session actor attempting the close — null on API-key-only calls */
  actorUserId: string | null;
  /** actor of the latest operational→remediated lifecycle event (null if unknown) */
  remediatorUserId: string | null;
}

/**
 * Pure decision-transition guard (spec §4). No I/O; never throws.
 *
 *   needs_review → mitigating            (accept plan)
 *   any          → accepted_risk         (governance override; always audited)
 *   *            → resolved              (close) — ONLY when operational_status
 *                                        = remediated OR current = accepted_risk;
 *                                        org-enforced SoD additionally requires
 *                                        an identified actor ≠ the remediator
 *   resolved     → needs_review          (reopen)
 */
export function evaluateFindingDecisionTransition(
  currentRaw: string | null | undefined,
  targetRaw: string,
  gates: { operationalStatus: string | null | undefined; sod?: ClosureSodGate }
): DecisionTransitionDecision {
  const current = typeof currentRaw === "string" && VALID_DECISION.has(currentRaw)
    ? (currentRaw as FindingDecisionState)
    : undefined;
  if (current === undefined) return { allowed: false, reason: "unknown_state" };

  if (!VALID_DECISION.has(targetRaw)) {
    return { allowed: false, reason: "invalid_decision_state", fromState: current };
  }
  const target = targetRaw as FindingDecisionState;

  if (target === current) {
    return { allowed: true, noop: true, fromState: current, toState: target };
  }

  switch (target) {
    case "mitigating":
      if (current === "needs_review") {
        return {
          allowed: true, fromState: current, toState: target,
          transition: "accept_plan", auditEvent: "finding.decision.mitigating",
        };
      }
      return { allowed: false, reason: "invalid_decision_transition", fromState: current, toState: target };

    case "accepted_risk":
      // spec §4: "any | accept risk" — an explicit, audited governance override.
      return {
        allowed: true, fromState: current, toState: target,
        transition: "accept_risk", auditEvent: "finding.decision.accepted_risk",
      };

    case "resolved": {
      const guard =
        gates.operationalStatus === "remediated" || current === "accepted_risk";
      if (!guard) {
        return {
          allowed: false,
          reason: "close_requires_remediated_or_accepted_risk",
          fromState: current, toState: target,
        };
      }
      // Org-enforced separation of duties (spec §7): the closer must be an
      // identified user and must not be the person who completed the
      // remediation. Mirrors the Risk machine's actor_identity_required /
      // separation_of_duties gates.
      if (gates.sod?.enforced) {
        if (gates.sod.actorUserId === null) {
          return {
            allowed: false, reason: "actor_identity_required",
            fromState: current, toState: target,
          };
        }
        if (
          gates.sod.remediatorUserId !== null &&
          gates.sod.actorUserId === gates.sod.remediatorUserId
        ) {
          return {
            allowed: false, reason: "separation_of_duties",
            fromState: current, toState: target,
          };
        }
      }
      return {
        allowed: true, fromState: current, toState: target,
        transition: "close", auditEvent: "finding.decision.resolved",
      };
    }

    case "needs_review":
      if (current === "resolved") {
        return {
          allowed: true, fromState: current, toState: target,
          transition: "reopen", auditEvent: "finding.reopened",
        };
      }
      return { allowed: false, reason: "invalid_decision_transition", fromState: current, toState: target };
  }
}

