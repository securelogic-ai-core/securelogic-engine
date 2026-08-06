/**
 * Composer honest-state tests (Briefing Initiative B1).
 *
 * The dashboardState.ts discipline, generalized: failed fetch = unknown (never
 * zero), zeros payload = real all-clear, unknown personal count never selects a
 * personal presentation, null posture score = insufficient data.
 */
import { describe, it, expect } from "vitest";
import {
  composeBriefing,
  rankMyWorkItems,
  rankPostureDrivers,
  type MyWorkTopItem,
} from "../composeBriefing";
import type { Action, ActionsSummary, DashboardSummary, DomainScore, Finding, FindingsSummary } from "@/lib/api";

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
      // EX1 PR-2: lists not fetched → feature absent, no failures signaled.
      topItems: null,
      topItemsFindingsFailed: false,
      topItemsActionsFailed: false,
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

// ─── EX1 PR-2: My Work top items — deterministic ranking + honest states ─────

const NOW = new Date("2026-08-06T12:00:00.000Z");

function aFinding(overrides: Partial<Finding>): Finding {
  return { ...({
    id: "f-0000", organization_id: "org", assessment_id: null, source_type: "manual",
    source_id: null, title: "A finding", description: "", severity: "High",
    domain: "Vendor Risk", framework_control_id: null, priority: "near_term",
    status: "open", confidence: null, due_date: null,
    created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z",
  } as unknown as Finding), ...overrides };
}

function anAction(overrides: Partial<Action>): Action {
  return { ...({
    id: "a-0000", organization_id: "org", title: "An action", description: null,
    source_type: "finding", source_id: null, priority: "planned", due_date: null,
    owner_user_id: "u1", status: "open",
  } as unknown as Action), ...overrides };
}

describe("rankMyWorkItems — deterministic prioritization", () => {
  it("overdue beats urgency; urgency beats due date; ids make the order total", () => {
    const findings = [
      aFinding({ id: "f-crit", severity: "Critical", due_date: "2026-08-20T00:00:00.000Z" }),
      aFinding({ id: "f-high-overdue", severity: "High", due_date: "2026-08-01T00:00:00.000Z" }),
    ];
    const actions = [
      anAction({ id: "a-imm", priority: "immediate", due_date: "2026-08-10T00:00:00.000Z" }),
    ];
    const ranked = rankMyWorkItems(findings, actions, NOW);
    // Overdue High first (overdue outranks the not-yet-due Critical). The
    // Immediate action and the Critical finding tie on urgency (both rank 0),
    // so due dates decide: action due Aug 10 < finding due Aug 20.
    expect(ranked.map((i) => i.id)).toEqual(["f-high-overdue", "a-imm", "f-crit"]);
    expect(ranked[0].overdue).toBe(true);
  });

  it("is order-insensitive: permuted inputs produce the identical list", () => {
    const findings = [
      aFinding({ id: "f-1", severity: "High", due_date: "2026-08-10T00:00:00.000Z" }),
      aFinding({ id: "f-2", severity: "High", due_date: "2026-08-10T00:00:00.000Z" }),
    ];
    const actions = [
      anAction({ id: "a-1", priority: "near_term", due_date: "2026-08-10T00:00:00.000Z" }),
    ];
    const a = rankMyWorkItems(findings, actions, NOW);
    const b = rankMyWorkItems([...findings].reverse(), actions, NOW);
    expect(a).toEqual(b);
    // Full tie on ⟨overdue, urgency, due⟩ → finding-before-action, then id.
    expect(a.map((i) => i.id)).toEqual(["f-1", "f-2", "a-1"]);
  });

  it("caps at 3 and carries the WHY (urgency label, overdue, due date, deep link)", () => {
    const findings = [
      aFinding({ id: "f-1", severity: "Critical" }),
      aFinding({ id: "f-2", severity: "Critical" }),
      aFinding({ id: "f-3", severity: "Critical" }),
      aFinding({ id: "f-4", severity: "Critical" }),
    ];
    const ranked = rankMyWorkItems(findings, [], NOW);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]).toMatchObject({
      urgency: "Critical", urgencyRank: 0, href: "/findings/f-1", overdue: false,
    });
  });

  it("actions link to the owner queue (no detail route) with display-ready labels", () => {
    const ranked = rankMyWorkItems([], [anAction({ id: "a-1", priority: "near_term" })], NOW);
    expect(ranked[0]).toMatchObject({ href: "/actions?view=mine", urgency: "Near term" });
  });
});

describe("composeBriefing — My Work top-item honest states", () => {
  it("null list input = FAILED fetch: flagged, other source still ranked", () => {
    const vm = composeBriefing({
      summary: aSummary(), findingsSummary: aFindingsSummary({}), actionsSummary: anActionsSummary({}),
      myFindings: null,
      myActions: [anAction({ id: "a-1", priority: "immediate" })],
      now: NOW,
    });
    expect(vm.myWork.topItemsFindingsFailed).toBe(true);
    expect(vm.myWork.topItemsActionsFailed).toBe(false);
    expect(vm.myWork.topItems?.map((i: MyWorkTopItem) => i.id)).toEqual(["a-1"]);
  });

  it("both lists loaded and empty = empty array (row hidden), never null", () => {
    const vm = composeBriefing({
      summary: aSummary(), findingsSummary: aFindingsSummary({}), actionsSummary: anActionsSummary({}),
      myFindings: [], myActions: [], now: NOW,
    });
    expect(vm.myWork.topItems).toEqual([]);
    expect(vm.myWork.topItemsFindingsFailed).toBe(false);
  });

  it("undefined inputs = feature absent: topItems null, no failure flags", () => {
    const vm = composeBriefing({
      summary: aSummary(), findingsSummary: aFindingsSummary({}), actionsSummary: anActionsSummary({}),
    });
    expect(vm.myWork.topItems).toBeNull();
    expect(vm.myWork.topItemsFindingsFailed).toBe(false);
    expect(vm.myWork.topItemsActionsFailed).toBe(false);
  });
});

// ─── EX1 PR-3: Posture Driver — deterministic ranking + honest states ────────

function aDomain(overrides: Partial<DomainScore> = {}): DomainScore {
  return {
    domain: "Cyber",
    score: 55,
    severity: "High",
    finding_count: 3,
    action_count: 0,
    trend_direction: "unknown",
    ...overrides,
  };
}

describe("rankPostureDrivers — deterministic worst-domain ranking", () => {
  it("ranks by display score ascending (lowest health = the driver)", () => {
    const ranked = rankPostureDrivers([
      aDomain({ domain: "Cyber", score: 70 }),
      aDomain({ domain: "Vendor Risk", score: 22, severity: "Critical" }),
      aDomain({ domain: "Regulatory", score: 48 }),
    ]);
    expect(ranked.map((d) => d.domain)).toEqual(["Vendor Risk", "Regulatory", "Cyber"]);
    expect(ranked[0].severity).toBe("Critical");
  });

  it("ties break by finding_count (more findings ranks worse), then domain name", () => {
    const byCount = rankPostureDrivers([
      aDomain({ domain: "Cyber", score: 40, finding_count: 1 }),
      aDomain({ domain: "AI Governance", score: 40, finding_count: 6 }),
    ]);
    expect(byCount.map((d) => d.domain)).toEqual(["AI Governance", "Cyber"]);

    const byName = rankPostureDrivers([
      aDomain({ domain: "Cyber", score: 40, finding_count: 2 }),
      aDomain({ domain: "AI Governance", score: 40, finding_count: 2 }),
    ]);
    expect(byName.map((d) => d.domain)).toEqual(["AI Governance", "Cyber"]);
  });

  it("is order-insensitive: permuted inputs produce the identical ranking", () => {
    const domains = [
      aDomain({ domain: "Cyber", score: 40 }),
      aDomain({ domain: "AI Governance", score: 40 }),
      aDomain({ domain: "Vendor Risk", score: 12 }),
    ];
    expect(rankPostureDrivers(domains)).toEqual(
      rankPostureDrivers([...domains].reverse()),
    );
  });

  it("excludes unscored domains — a null score carries no computed weight", () => {
    const ranked = rankPostureDrivers([
      aDomain({ domain: "Cyber", score: null }),
      aDomain({ domain: "Regulatory", score: 60 }),
    ]);
    expect(ranked.map((d) => d.domain)).toEqual(["Regulatory"]);
    expect(rankPostureDrivers([aDomain({ score: null })])).toEqual([]);
  });

  it("caps at 3 factors and deep-links the domain-filtered active findings", () => {
    const ranked = rankPostureDrivers([
      aDomain({ domain: "A", score: 10 }),
      aDomain({ domain: "B", score: 20 }),
      aDomain({ domain: "C", score: 30 }),
      aDomain({ domain: "D", score: 40 }),
    ]);
    expect(ranked).toHaveLength(3);
    expect(ranked[0].href).toBe("/findings?domain=A&active=true");
  });

  it("URL-encodes multi-word domains in the evidence link", () => {
    const [d] = rankPostureDrivers([aDomain({ domain: "Vendor Risk", score: 30 })]);
    expect(d.href).toBe("/findings?domain=Vendor%20Risk&active=true");
  });

  it("a zero-finding domain is signal-driven: no findings link, /posture instead", () => {
    const [d] = rankPostureDrivers([
      aDomain({ domain: "Vendor Risk", score: 30, finding_count: 0 }),
    ]);
    expect(d.signalDriven).toBe(true);
    expect(d.href).toBe("/posture");
  });
});

describe("composeBriefing — posture driver honest states", () => {
  const FRESH = "2026-08-05"; // NOW is 2026-08-06 — one day old, not stale.

  function drivenSummary(
    domains: DomainScore[],
    snapshotDate: string | null = FRESH,
  ): DashboardSummary {
    return aSummary({
      posture: { overall_score: 58, overall_severity: "Moderate", snapshot_date: snapshotDate },
      domains,
    });
  }

  it("no overall score = no driver, even when domain rows exist", () => {
    const vm = composeBriefing({
      summary: aSummary({
        posture: { overall_score: null, overall_severity: null, snapshot_date: null },
        domains: [aDomain()],
      }),
      findingsSummary: null,
      actionsSummary: null,
      now: NOW,
    });
    expect(vm.postureScore.driver).toBeNull();
  });

  it("a score with NO scored domain breakdown gets no driver — never a guessed one", () => {
    const noDomains = composeBriefing({
      summary: drivenSummary([]),
      findingsSummary: null, actionsSummary: null, now: NOW,
    });
    expect(noDomains.postureScore.driver).toBeNull();

    const allUnscored = composeBriefing({
      summary: drivenSummary([aDomain({ score: null })]),
      findingsSummary: null, actionsSummary: null, now: NOW,
    });
    expect(allUnscored.postureScore.driver).toBeNull();
  });

  it("surfaces the worst domain as primary with ≤2 supporting and the scored count", () => {
    const vm = composeBriefing({
      summary: drivenSummary([
        aDomain({ domain: "Cyber", score: 70 }),
        aDomain({ domain: "Vendor Risk", score: 22, severity: "Critical", finding_count: 5 }),
        aDomain({ domain: "Regulatory", score: 48 }),
        aDomain({ domain: "AI Governance", score: 90 }),
      ]),
      findingsSummary: null, actionsSummary: null, now: NOW,
    });
    const d = vm.postureScore.driver!;
    expect(d.primary).toMatchObject({
      domain: "Vendor Risk",
      score: 22,
      severity: "Critical",
      findingCount: 5,
      signalDriven: false,
      href: "/findings?domain=Vendor%20Risk&active=true",
    });
    expect(d.supporting.map((s) => s.domain)).toEqual(["Regulatory", "Cyber"]);
    expect(d.scoredDomainCount).toBe(4);
    expect(d.stale).toBe(false);
  });

  it("a snapshot older than 3 days is flagged stale; a fresh one is not", () => {
    const stale = composeBriefing({
      summary: drivenSummary([aDomain()], "2026-08-01"),
      findingsSummary: null, actionsSummary: null, now: NOW,
    });
    expect(stale.postureScore.driver?.stale).toBe(true);

    const fresh = composeBriefing({
      summary: drivenSummary([aDomain()], FRESH),
      findingsSummary: null, actionsSummary: null, now: NOW,
    });
    expect(fresh.postureScore.driver?.stale).toBe(false);
  });

  it("an unparseable snapshot date is not claimed stale (unknown ≠ stale)", () => {
    const vm = composeBriefing({
      summary: drivenSummary([aDomain()], null),
      findingsSummary: null, actionsSummary: null, now: NOW,
    });
    expect(vm.postureScore.driver?.stale).toBe(false);
  });
});
