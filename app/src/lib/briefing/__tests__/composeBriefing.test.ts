/**
 * Composer honest-state tests (Briefing Initiative B1).
 *
 * The dashboardState.ts discipline, generalized: failed fetch = unknown (never
 * zero), zeros payload = real all-clear, unknown personal count never selects a
 * personal presentation, null posture score = insufficient data.
 */
import { describe, it, expect } from "vitest";
import { composeBriefing } from "../composeBriefing";
import type { ActionsSummary, DashboardSummary, FindingsSummary } from "@/lib/api";

function aSummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    posture: { overall_score: 62, overall_severity: "Moderate", snapshot_date: "2026-07-20" },
    domains: [],
    findings: {
      open: 8,
      by_severity: { Critical: 2, High: 3, Moderate: 2, Low: 1 },
      pending_independent_review: 5,
    },
    actions: { open: 4, in_progress: 2, blocked: 1, active: 7, overdue: 2 },
    ...overrides,
  } as DashboardSummary;
}

function aFindingsSummary(overrides: Partial<FindingsSummary> = {}): FindingsSummary {
  return {
    open_count: 8,
    critical_open: 2,
    high_open: 3,
    medium_open: 2,
    low_open: 1,
    closed_count: 4,
    immediate_priority: 1,
    vendor_sourced: 0,
    signal_sourced: 0,
    ...overrides,
  } as FindingsSummary;
}

function anActionsSummary(overrides: Partial<ActionsSummary> = {}): ActionsSummary {
  return {
    open_count: 7,
    blocked_count: 1,
    overdue_count: 2,
    immediate_count: 1,
    closed_count: 3,
    my_open_count: 2,
    my_overdue_count: 1,
    ...overrides,
  };
}

describe("composeBriefing — organization zone", () => {
  it("a FAILED summary fetch is an error state, never zeros", () => {
    const vm = composeBriefing({ summary: null, findingsSummary: null, actionsSummary: null });
    expect(vm.orgLoaded).toBe(false);
  });

  it("a zeros summary is a real all-clear (orgLoaded true, zero counts)", () => {
    const vm = composeBriefing({
      summary: aSummary({
        findings: { open: 0, by_severity: { Critical: 0, High: 0, Moderate: 0, Low: 0 } },
        actions: { open: 0, in_progress: 0, active: 0, blocked: 0, overdue: 0 },
      } as Partial<DashboardSummary> as never),
      findingsSummary: null,
      actionsSummary: null,
    });
    expect(vm.orgLoaded).toBe(true);
    expect(vm.needsAttention).toEqual({ critical: 0, high: 0 });
    expect(vm.overdueActions).toEqual({ active: 0, overdue: 0 });
  });

  it("prefers the Metric Contract `active` field; falls back to summing exact parts", () => {
    const withActive = composeBriefing({
      summary: aSummary(),
      findingsSummary: null,
      actionsSummary: null,
    });
    expect(withActive.overdueActions.active).toBe(7);

    const withoutActive = composeBriefing({
      summary: aSummary({
        actions: { open: 4, in_progress: 2, blocked: 1, overdue: 2 } as never,
      }),
      findingsSummary: null,
      actionsSummary: null,
    });
    expect(withoutActive.overdueActions.active).toBe(7); // 4 + 2 + 1
  });

  it("posture score null = insufficient data, never zero", () => {
    const vm = composeBriefing({
      summary: aSummary({
        posture: { overall_score: null, overall_severity: null, snapshot_date: null },
      }),
      findingsSummary: null,
      actionsSummary: null,
    });
    expect(vm.postureScore.score).toBeNull();
  });

  it("empty ready-to-close population hides the module (null, not a zero card)", () => {
    const vm = composeBriefing({
      summary: aSummary({
        findings: {
          open: 8,
          by_severity: { Critical: 2, High: 3, Moderate: 2, Low: 1 },
          pending_independent_review: 0,
        } as never,
      }),
      findingsSummary: null,
      actionsSummary: null,
    });
    expect(vm.readyToClose).toBeNull();
  });
});

describe("composeBriefing — personal counts (scope honesty)", () => {
  it("unknown personal review count NEVER selects the personal module (a817aa36 rule)", () => {
    // findingsSummary failed → mine is unknown, org population is 5.
    const vm = composeBriefing({
      summary: aSummary(),
      findingsSummary: null,
      actionsSummary: null,
    });
    expect(vm.myPendingReviews).toBeNull();
    expect(vm.readyToClose).toEqual({ orgWide: 5 });
  });

  it("a known non-zero personal count surfaces My Pending Reviews with the org total as context", () => {
    const vm = composeBriefing({
      summary: aSummary(),
      findingsSummary: aFindingsSummary({ my_pending_reviews_open: 1 }),
      actionsSummary: null,
    });
    expect(vm.myPendingReviews).toEqual({ mine: 1, orgWide: 5 });
  });

  it("a known ZERO personal count hides the personal module", () => {
    const vm = composeBriefing({
      summary: aSummary(),
      findingsSummary: aFindingsSummary({ my_pending_reviews_open: 0 }),
      actionsSummary: null,
    });
    expect(vm.myPendingReviews).toBeNull();
  });

  it("My Work: failed summaries are unknown (null), not fake zeros", () => {
    const vm = composeBriefing({ summary: aSummary(), findingsSummary: null, actionsSummary: null });
    expect(vm.myWork.findingsOpen).toBeNull();
    expect(vm.myWork.actionsOpen).toBeNull();
    expect(vm.myWork.allClear).toBe(false); // unknown is not clear
  });

  it("My Work all-clear only when every count is KNOWN and zero", () => {
    const vm = composeBriefing({
      summary: aSummary(),
      findingsSummary: aFindingsSummary({ my_work_open: 0 }),
      actionsSummary: anActionsSummary({ my_open_count: 0, my_overdue_count: 0 }),
    });
    expect(vm.myWork).toEqual({
      findingsOpen: 0,
      actionsOpen: 0,
      actionsOverdue: 0,
      allClear: true,
    });
  });

  it("My Work carries the caller's own counts from the Metric Contract fields", () => {
    const vm = composeBriefing({
      summary: aSummary(),
      findingsSummary: aFindingsSummary({ my_work_open: 3 }),
      actionsSummary: anActionsSummary({ my_open_count: 2, my_overdue_count: 1 }),
    });
    expect(vm.myWork.findingsOpen).toBe(3);
    expect(vm.myWork.actionsOpen).toBe(2);
    expect(vm.myWork.actionsOverdue).toBe(1);
    expect(vm.myWork.allClear).toBe(false);
  });
});
