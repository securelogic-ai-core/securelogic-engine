/**
 * vendorEngagements — the UI-side mirror of the engine's engagement state
 * machine (src/api/lib/vendorRisk/engagementStateMachine.ts).
 *
 * These tests pin the mirror to the engine's ratified shape: which action is
 * offered from which state, that every locked action explains itself, that a
 * review due TODAY is not overdue (the engine sweep's CURRENT_DATE semantics),
 * and that `deterministic_only` coverage can never read as a clean pass.
 */
import { describe, it, expect } from "vitest";
import {
  ENGAGEMENT_STATES,
  ENGAGEMENT_STATE_LABELS,
  TERMINAL_ENGAGEMENT_STATES,
  isEngagementState,
  isTerminal,
  canOverrideInherent,
  canResolveScope,
  canIssue,
  canBeginReview,
  canCompleteAnalysis,
  canRecompute,
  canDecide,
  canStartMonitoring,
  canRefreshMonitoring,
  canPromoteFindings,
  canComment,
  isActionAvailable,
  actionUnavailableReason,
  analysisCoverageCopy,
  isReviewOverdue,
  todayISODate,
  bandColors,
  portalInviteUrl,
  RISK_BANDS,
  type EngagementAction,
  type EngagementState,
} from "../vendorEngagements";

const ALL_ACTIONS: EngagementAction[] = [
  "override_inherent",
  "resolve_scope",
  "issue",
  "begin_review",
  "complete_analysis",
  "recompute",
  "decide",
  "start_monitoring",
  "promote_findings",
];

describe("engagement states", () => {
  it("mirrors the engine's fifteen states in workflow order", () => {
    expect(ENGAGEMENT_STATES).toEqual([
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
    ]);
  });

  it("has a human label for every state", () => {
    for (const s of ENGAGEMENT_STATES) {
      expect(ENGAGEMENT_STATE_LABELS[s]).toBeTruthy();
    }
  });

  it("isEngagementState accepts every state and rejects everything else", () => {
    for (const s of ENGAGEMENT_STATES) expect(isEngagementState(s)).toBe(true);
    expect(isEngagementState("finalized")).toBe(false);
    expect(isEngagementState("")).toBe(false);
    expect(isEngagementState(null)).toBe(false);
    expect(isEngagementState(undefined)).toBe(false);
  });

  it("exactly closed, cancelled and expired are terminal", () => {
    expect([...TERMINAL_ENGAGEMENT_STATES].sort()).toEqual(["cancelled", "closed", "expired"]);
    for (const s of ENGAGEMENT_STATES) {
      expect(isTerminal(s)).toBe(TERMINAL_ENGAGEMENT_STATES.includes(s));
    }
  });
});

describe("per-action availability (mirror of the engine transition table)", () => {
  const only = (states: EngagementState[], predicate: (s: EngagementState) => boolean) => {
    for (const s of ENGAGEMENT_STATES) {
      expect(predicate(s), `state=${s}`).toBe(states.includes(s));
    }
  };

  it("scope and inherent are mutable only before issue", () => {
    only(["draft", "scoping", "scoped"], canResolveScope);
    only(["draft", "scoping", "scoped"], canOverrideInherent);
  });

  it("issue only from scoped — the machine's one issue transition", () => {
    only(["scoped"], canIssue);
  });

  it("begin review only from submitted", () => {
    only(["submitted"], canBeginReview);
  });

  it("complete analysis only from in_review (NOT from clarification_requested)", () => {
    only(["in_review"], canCompleteAnalysis);
  });

  it("recompute and promote-findings are offered from review onward", () => {
    const reviewOnward: EngagementState[] = [
      "in_review",
      "clarification_requested",
      "analysis_complete",
      "decision_pending",
      "decided",
      "monitoring",
    ];
    only(reviewOnward, canRecompute);
    only(reviewOnward, canPromoteFindings);
  });

  it("decide only from decision_pending", () => {
    only(["decision_pending"], canDecide);
  });

  it("monitoring starts from decided and refreshes from monitoring", () => {
    only(["decided"], canStartMonitoring);
    only(["monitoring"], canRefreshMonitoring);
  });

  it("comments are open in every non-terminal state, closed in every terminal one", () => {
    for (const s of ENGAGEMENT_STATES) {
      expect(canComment(s)).toBe(!isTerminal(s));
    }
  });

  it("isActionAvailable agrees with the named predicates", () => {
    for (const s of ENGAGEMENT_STATES) {
      expect(isActionAvailable("issue", s)).toBe(canIssue(s));
      expect(isActionAvailable("begin_review", s)).toBe(canBeginReview(s));
      expect(isActionAvailable("complete_analysis", s)).toBe(canCompleteAnalysis(s));
      expect(isActionAvailable("recompute", s)).toBe(canRecompute(s));
      expect(isActionAvailable("decide", s)).toBe(canDecide(s));
      expect(isActionAvailable("promote_findings", s)).toBe(canPromoteFindings(s));
      expect(isActionAvailable("override_inherent", s)).toBe(canOverrideInherent(s));
      expect(isActionAvailable("resolve_scope", s)).toBe(canResolveScope(s));
      // The panel's one merged row: start OR refresh.
      expect(isActionAvailable("start_monitoring", s)).toBe(
        canStartMonitoring(s) || canRefreshMonitoring(s)
      );
    }
  });
});

describe("actionUnavailableReason — every locked action explains itself", () => {
  it("returns null exactly when the action is available", () => {
    for (const action of ALL_ACTIONS) {
      for (const s of ENGAGEMENT_STATES) {
        const reason = actionUnavailableReason(action, s);
        if (isActionAvailable(action, s)) {
          expect(reason, `${action} @ ${s}`).toBeNull();
        } else {
          expect(typeof reason, `${action} @ ${s}`).toBe("string");
          expect((reason as string).length, `${action} @ ${s}`).toBeGreaterThan(10);
        }
      }
    }
  });

  it("terminal states get the terminal explanation for every action", () => {
    for (const s of TERMINAL_ENGAGEMENT_STATES) {
      for (const action of ALL_ACTIONS) {
        const reason = actionUnavailableReason(action, s);
        expect(reason).toContain(ENGAGEMENT_STATE_LABELS[s].toLowerCase());
      }
    }
  });

  it("issue from draft tells the reviewer to resolve scope first", () => {
    expect(actionUnavailableReason("issue", "draft")).toMatch(/scope/i);
    expect(actionUnavailableReason("issue", "scoping")).toMatch(/scope/i);
  });

  it("issue after issue says it already happened", () => {
    expect(actionUnavailableReason("issue", "in_progress")).toMatch(/already been issued/i);
  });

  it("complete_analysis from clarification_requested explains the vendor round-trip", () => {
    expect(actionUnavailableReason("complete_analysis", "clarification_requested")).toMatch(
      /clarification/i
    );
  });

  it("decide before decision_pending points at recompute; after, says already decided", () => {
    expect(actionUnavailableReason("decide", "analysis_complete")).toMatch(/recompute/i);
    expect(actionUnavailableReason("decide", "decided")).toMatch(/already/i);
    expect(actionUnavailableReason("decide", "monitoring")).toMatch(/already/i);
  });

  it("inherent override after issue explains the freeze", () => {
    expect(actionUnavailableReason("override_inherent", "issued")).toMatch(/issued/i);
    expect(actionUnavailableReason("resolve_scope", "issued")).toMatch(/frozen/i);
  });
});

describe("isReviewOverdue — the engine sweep's CURRENT_DATE semantics", () => {
  const today = "2026-08-13";

  it("a review due TODAY is NOT overdue", () => {
    expect(isReviewOverdue("2026-08-13", today)).toBe(false);
  });

  it("a review due yesterday IS overdue", () => {
    expect(isReviewOverdue("2026-08-12", today)).toBe(true);
  });

  it("a review due tomorrow is not overdue", () => {
    expect(isReviewOverdue("2026-08-14", today)).toBe(false);
  });

  it("no review date means not overdue", () => {
    expect(isReviewOverdue(null, today)).toBe(false);
    expect(isReviewOverdue(undefined, today)).toBe(false);
    expect(isReviewOverdue("", today)).toBe(false);
  });

  it("compares at DATE precision even when given a timestamp", () => {
    // Same calendar day with a time component: still due today, still not overdue.
    expect(isReviewOverdue("2026-08-13T09:30:00.000Z", today)).toBe(false);
    expect(isReviewOverdue("2026-08-12T23:59:59.000Z", today)).toBe(true);
  });

  it("defaults today to the current UTC date", () => {
    expect(todayISODate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Far past is overdue, far future is not, against the real default.
    expect(isReviewOverdue("2000-01-01")).toBe(true);
    expect(isReviewOverdue("2999-01-01")).toBe(false);
  });
});

describe("analysisCoverageCopy — deterministic_only must never read as a clean pass", () => {
  it("full is the only ok tone", () => {
    expect(analysisCoverageCopy("full").tone).toBe("ok");
    expect(analysisCoverageCopy("partial").tone).toBe("warn");
    expect(analysisCoverageCopy("deterministic_only").tone).toBe("warn");
  });

  it("deterministic_only says explicitly that it is not a clean pass", () => {
    const copy = analysisCoverageCopy("deterministic_only");
    expect(copy.label).toMatch(/no ai analysis/i);
    expect(copy.detail).toMatch(/not a clean pass/i);
    expect(copy.detail).toMatch(/human/i);
  });

  it("partial names the human obligation for the unanalysed remainder", () => {
    expect(analysisCoverageCopy("partial").detail).toMatch(/human/i);
  });
});

describe("bandColors", () => {
  it("gives each of the four bands a distinct color set", () => {
    const seen = new Set(RISK_BANDS.map((b) => bandColors(b).fg));
    expect(seen.size).toBe(RISK_BANDS.length);
  });

  it("falls back to the neutral set for unknown or absent bands", () => {
    const neutral = bandColors(null);
    expect(bandColors(undefined)).toEqual(neutral);
    expect(bandColors("Weird")).toEqual(neutral);
    for (const b of RISK_BANDS) {
      expect(bandColors(b)).not.toEqual(neutral);
    }
  });
});

describe("portalInviteUrl", () => {
  it("builds the portal accept path from the origin", () => {
    expect(portalInviteUrl("https://app.example.com", "tok123")).toBe(
      "https://app.example.com/portal/accept/tok123"
    );
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(portalInviteUrl("https://app.example.com/", "tok123")).toBe(
      "https://app.example.com/portal/accept/tok123"
    );
  });

  it("URL-encodes the token", () => {
    expect(portalInviteUrl("https://a.example", "a/b+c")).toBe(
      "https://a.example/portal/accept/a%2Fb%2Bc"
    );
  });
});
