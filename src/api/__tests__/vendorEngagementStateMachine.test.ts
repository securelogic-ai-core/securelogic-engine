/**
 * vendorEngagementStateMachine.test.ts
 *
 * The load-bearing test here is the AUTHORIZATION INVARIANT: an external portal
 * session may cause exactly three transitions and no others. It is asserted
 * exhaustively — over every (from, to) pair in the state space, not just the
 * ones someone remembered to list — because the failure mode is a transition
 * that becomes reachable from outside by omission.
 */
import { describe, it, expect } from "vitest";
import {
  ALL_TRANSITIONS,
  ENGAGEMENT_STATES,
  TERMINAL_STATES,
  canTransition,
  findTransition,
  isInherentOverridable,
  isPortalWritable,
  isScopeMutable,
  portalPermittedTransitions,
  type EngagementState,
} from "../lib/vendorRisk/engagementStateMachine.js";

describe("engagement state machine — the portal authorization invariant", () => {
  it("a portal session may cause EXACTLY three transitions", () => {
    const allowed = portalPermittedTransitions().map((t) => `${t.from}->${t.to}`).sort();
    expect(allowed).toEqual(
      [
        "clarification_requested->in_progress",
        "in_progress->submitted",
        "issued->in_progress",
      ].sort()
    );
  });

  it("EXHAUSTIVE: every other (from,to) pair is refused for a portal actor", () => {
    // The whole state space, not a curated list — a new transition added
    // without thought about external reachability fails here.
    const permitted = new Set(
      portalPermittedTransitions().map((t) => `${t.from}->${t.to}`)
    );
    const leaks: string[] = [];

    for (const from of ENGAGEMENT_STATES) {
      for (const to of ENGAGEMENT_STATES) {
        if (from === to) continue;
        const key = `${from}->${to}`;
        const result = canTransition(from, to, "portal");
        if (result.allowed && !permitted.has(key)) leaks.push(key);
      }
    }

    expect(
      leaks,
      "These transitions are reachable from an EXTERNAL portal session and should not be."
    ).toEqual([]);
  });

  it("a portal session can never reach a decision", () => {
    // The decision is always human and always internal.
    expect(canTransition("decision_pending", "decided", "portal").allowed).toBe(false);
    expect(canTransition("analysis_complete", "decision_pending", "portal").allowed).toBe(false);
    expect(canTransition("decided", "monitoring", "portal").allowed).toBe(false);
  });

  it("a portal session cannot issue, cancel, or close an engagement", () => {
    expect(canTransition("scoped", "issued", "portal").allowed).toBe(false);
    expect(canTransition("in_progress", "cancelled", "portal").allowed).toBe(false);
    expect(canTransition("monitoring", "closed", "portal").allowed).toBe(false);
  });
});

describe("engagement state machine — legality", () => {
  it("fails CLOSED on an unknown pair", () => {
    const r = canTransition("draft", "decided", "internal");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("illegal_transition");
  });

  it("distinguishes an illegal transition from a forbidden actor", () => {
    const r = canTransition("scoped", "issued", "portal");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("actor_not_permitted");
  });

  it("nothing leaves a terminal state", () => {
    for (const terminal of TERMINAL_STATES) {
      const outbound = ALL_TRANSITIONS.filter((t) => t.from === terminal);
      expect(outbound, `${terminal} has outbound transitions`).toEqual([]);
    }
  });

  it("every non-terminal state is reachable from draft", () => {
    // Guards against a state that exists in the enum but can never be entered —
    // dead vocabulary that misleads anyone reading the schema.
    const reachable = new Set<EngagementState>(["draft"]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of ALL_TRANSITIONS) {
        if (reachable.has(t.from) && !reachable.has(t.to)) {
          reachable.add(t.to);
          grew = true;
        }
      }
    }
    const unreachable = ENGAGEMENT_STATES.filter((s) => !reachable.has(s));
    expect(unreachable).toEqual([]);
  });

  it("the happy path is walkable end to end", () => {
    const path: EngagementState[] = [
      "draft", "scoping", "scoped", "issued", "in_progress", "submitted",
      "in_review", "analysis_complete", "decision_pending", "decided",
      "monitoring", "closed",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      const r = canTransition(path[i]!, path[i + 1]!, "internal");
      expect(r.allowed, `${path[i]} -> ${path[i + 1]} should be legal`).toBe(true);
    }
  });

  it("the clarification loop returns to in_progress and back", () => {
    expect(canTransition("in_review", "clarification_requested", "internal").allowed).toBe(true);
    expect(canTransition("clarification_requested", "in_progress", "portal").allowed).toBe(true);
    expect(canTransition("in_progress", "submitted", "portal").allowed).toBe(true);
  });
});

describe("engagement state machine — freeze semantics", () => {
  it("scope is mutable only before issue", () => {
    expect(isScopeMutable("draft")).toBe(true);
    expect(isScopeMutable("scoping")).toBe(true);
    expect(isScopeMutable("scoped")).toBe(true);
    // Frozen from here: the questionnaire a vendor answered can never be
    // rewritten underneath their answers.
    expect(isScopeMutable("issued")).toBe(false);
    expect(isScopeMutable("in_progress")).toBe(false);
    expect(isScopeMutable("decided")).toBe(false);
  });

  it("inherent risk is overridable on exactly the same window as scope", () => {
    // The tier derives from inherent and the frozen scope derives from the
    // tier, so a post-issue inherent change would leave scope derived from a
    // superseded value with nothing to signal the divergence.
    for (const s of ENGAGEMENT_STATES) {
      expect(isInherentOverridable(s), s).toBe(isScopeMutable(s));
    }
  });

  it("the freeze guard is declared on the issue transition", () => {
    const t = findTransition("scoped", "issued")!;
    expect(t.guards).toContain("freeze_scope");
  });

  it("portal writes stop at submission", () => {
    expect(isPortalWritable("issued")).toBe(true);
    expect(isPortalWritable("in_progress")).toBe(true);
    expect(isPortalWritable("submitted")).toBe(false);
    expect(isPortalWritable("in_review")).toBe(false);
    expect(isPortalWritable("clarification_requested")).toBe(false);
  });
});

describe("engagement state machine — decision guards", () => {
  it("a decision requires a rationale and resolved severe suggestions", () => {
    const t = findTransition("decision_pending", "decided")!;
    expect(t.guards).toContain("decision_rationale_present");
    expect(t.guards).toContain("critical_and_high_suggestions_resolved");
    expect(t.actors).toEqual(["internal"]);
  });

  it("residual must be computed before a decision can be pending", () => {
    expect(findTransition("analysis_complete", "decision_pending")!.guards).toContain(
      "residual_computed"
    );
  });

  it("analysis coverage is stamped when review completes", () => {
    // deterministic_only must never be silently indistinguishable from full.
    expect(findTransition("in_review", "analysis_complete")!.guards).toContain(
      "analysis_coverage_stamped"
    );
  });

  it("every transition carries a description", () => {
    for (const t of ALL_TRANSITIONS) {
      expect(t.description.length, `${t.from}->${t.to}`).toBeGreaterThan(10);
    }
  });
});
