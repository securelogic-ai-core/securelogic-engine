/**
 * queueControls.test.ts — pure URL-state logic for the scalable Risk Findings
 * queue toolbar. Dependency-free (mirrors decisionQueue.test.ts).
 */

import { describe, it, expect } from "vitest";
import {
  QUEUE_PAGE_SIZE,
  EMPTY_QUEUE_STATE,
  parseQueueState,
  hasActiveFilters,
  queueStateToParams,
  queueStateToQuery,
  queueHref,
  withField,
  activeFilterChips,
  clearFilter,
  clearAllFilters,
  pageCount,
  resultRangeLabel,
  buildPager,
  type QueueState,
} from "../queueControls";

describe("parseQueueState", () => {
  it("defaults to urgency sort, page 1, and no filters", () => {
    expect(parseQueueState({})).toEqual(EMPTY_QUEUE_STATE);
    expect(parseQueueState({}).sort).toBe("urgency");
    expect(parseQueueState({}).page).toBe(1);
  });

  it("reads and validates every control", () => {
    const s = parseQueueState({
      q: "MFA",
      severity: "High",
      domain: "Vendor Risk",
      governance: "needs_review",
      operational: "remediated",
      due: "overdue",
      mine: "1",
      has_action: "1",
      has_evidence: "1",
      created_from: "2026-01-01",
      created_to: "2026-02-01",
      sort: "severity",
      page: "3",
    });
    expect(s).toEqual({
      q: "MFA",
      severity: "High",
      domain: "Vendor Risk",
      governance: "needs_review",
      operational: "remediated",
      due: "overdue",
      assignedToMe: true,
      hasAction: true,
      hasEvidence: true,
      createdFrom: "2026-01-01",
      createdTo: "2026-02-01",
      sort: "severity",
      page: 3,
    });
  });

  it("rejects invalid enum values and malformed dates/pages (fail safe to empty/1)", () => {
    const s = parseQueueState({
      severity: "Nope",
      domain: "Atlantis",
      governance: "bogus",
      operational: "nope",
      due: "whenever",
      sort: "hacker",
      created_from: "not-a-date",
      page: "-4",
    });
    expect(s.severity).toBe("");
    expect(s.domain).toBe("");
    expect(s.governance).toBe("");
    expect(s.operational).toBe("");
    expect(s.due).toBe("");
    expect(s.sort).toBe("urgency");
    expect(s.createdFrom).toBe("");
    expect(s.page).toBe(1);
  });
});

describe("hasActiveFilters", () => {
  it("is false for the empty state and true once any filter/search is set", () => {
    expect(hasActiveFilters(EMPTY_QUEUE_STATE)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_QUEUE_STATE, sort: "newest", page: 5 })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_QUEUE_STATE, q: "x" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_QUEUE_STATE, assignedToMe: true })).toBe(true);
  });
});

describe("queueStateToParams", () => {
  it("maps to engine params with the queue page size and urgency default", () => {
    const p = queueStateToParams(EMPTY_QUEUE_STATE);
    expect(p).toEqual({ sort: "urgency", limit: QUEUE_PAGE_SIZE });
  });

  it("derives OFFSET from the 1-based page and maps governance→decision_state, mine→owner", () => {
    const p = queueStateToParams({
      ...EMPTY_QUEUE_STATE,
      governance: "resolved",
      operational: "open",
      assignedToMe: true,
      hasAction: true,
      hasEvidence: true,
      due: "soon",
      q: "cve",
      createdFrom: "2026-01-01",
      page: 3,
    });
    expect(p.decision_state).toBe("resolved");
    expect(p.operational_status).toBe("open");
    expect(p.owner).toBe("me");
    expect(p.has_action).toBe(true);
    expect(p.has_evidence).toBe(true);
    expect(p.due).toBe("soon");
    expect(p.q).toBe("cve");
    expect(p.created_from).toBe("2026-01-01");
    expect(p.offset).toBe(2 * QUEUE_PAGE_SIZE);
  });

  it("omits offset on page 1", () => {
    expect(queueStateToParams({ ...EMPTY_QUEUE_STATE, page: 1 }).offset).toBeUndefined();
  });
});

describe("queueStateToQuery / URL round-trip (Back-nav persistence)", () => {
  it("always carries queue=all so the browse view survives the workspace flag", () => {
    expect(queueStateToQuery(EMPTY_QUEUE_STATE)).toContain("queue=all");
  });

  it("omits defaults (urgency sort, page 1) to keep URLs clean", () => {
    const q = queueStateToQuery(EMPTY_QUEUE_STATE);
    expect(q).not.toContain("sort=");
    expect(q).not.toContain("page=");
  });

  it("round-trips every field: parse(query(state)) === state", () => {
    const state: QueueState = {
      q: "acme",
      severity: "Critical",
      domain: "AI Governance",
      governance: "mitigating",
      operational: "in_progress",
      due: "today",
      assignedToMe: true,
      hasAction: true,
      hasEvidence: false,
      createdFrom: "2026-03-01",
      createdTo: "2026-03-31",
      sort: "due_date",
      page: 4,
    };
    const params = Object.fromEntries(new URLSearchParams(queueStateToQuery(state)));
    expect(parseQueueState(params)).toEqual(state);
  });

  it("queueHref points at /findings", () => {
    expect(queueHref(EMPTY_QUEUE_STATE)).toMatch(/^\/findings\?/);
  });
});

describe("withField / clearFilter / clearAllFilters", () => {
  it("changing a filter resets to page 1, but changing the page does not", () => {
    const s: QueueState = { ...EMPTY_QUEUE_STATE, page: 5 };
    expect(withField(s, "severity", "High").page).toBe(1);
    expect(withField(s, "page", 6).page).toBe(6);
  });

  it("clearFilter removes just that filter and resets the page", () => {
    const s: QueueState = { ...EMPTY_QUEUE_STATE, severity: "High", domain: "Vendor Risk", page: 3 };
    const cleared = clearFilter(s, "severity");
    expect(cleared.severity).toBe("");
    expect(cleared.domain).toBe("Vendor Risk");
    expect(cleared.page).toBe(1);
  });

  it("clearAllFilters wipes filters/search but keeps the sort", () => {
    const s: QueueState = {
      ...EMPTY_QUEUE_STATE, q: "x", severity: "Low", assignedToMe: true, sort: "newest", page: 9,
    };
    const cleared = clearAllFilters(s);
    expect(hasActiveFilters(cleared)).toBe(false);
    expect(cleared.sort).toBe("newest");
    expect(cleared.page).toBe(1);
  });
});

describe("activeFilterChips", () => {
  it("emits one chip per active filter, each keyed to clear it", () => {
    const chips = activeFilterChips({
      ...EMPTY_QUEUE_STATE,
      q: "MFA",
      severity: "High",
      due: "overdue",
      assignedToMe: true,
      hasAction: true,
    });
    const keys = chips.map((c) => c.key);
    expect(keys).toContain("q");
    expect(keys).toContain("severity");
    expect(keys).toContain("due");
    expect(keys).toContain("assignedToMe");
    expect(keys).toContain("hasAction");
    expect(chips.find((c) => c.key === "q")!.label).toContain("MFA");
    expect(chips.find((c) => c.key === "due")!.label).toBe("Overdue");
  });

  it("is empty when nothing is filtered", () => {
    expect(activeFilterChips(EMPTY_QUEUE_STATE)).toEqual([]);
  });
});

describe("pagination", () => {
  it("pageCount is ceil(total / page size), at least 1", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(QUEUE_PAGE_SIZE)).toBe(1);
    expect(pageCount(QUEUE_PAGE_SIZE + 1)).toBe(2);
    expect(pageCount(QUEUE_PAGE_SIZE * 8 + 3)).toBe(9);
  });

  it("resultRangeLabel reports the inclusive 1-based window", () => {
    expect(resultRangeLabel(1, QUEUE_PAGE_SIZE, 214)).toBe(`1–${QUEUE_PAGE_SIZE} of 214`);
    expect(resultRangeLabel(2, 10, 35)).toBe(`${QUEUE_PAGE_SIZE + 1}–${QUEUE_PAGE_SIZE + 10} of 35`);
    expect(resultRangeLabel(1, 0, 0)).toBe("No findings");
  });

  it("buildPager clamps the page and exposes prev/next hrefs", () => {
    const many = buildPager({ ...EMPTY_QUEUE_STATE, page: 2 }, QUEUE_PAGE_SIZE * 5);
    expect(many.pages).toBe(5);
    expect(many.page).toBe(2);
    expect(many.prevHref).toContain("/findings?");
    expect(many.nextHref).toContain("page=3");

    const first = buildPager(EMPTY_QUEUE_STATE, QUEUE_PAGE_SIZE * 3);
    expect(first.prevHref).toBeNull();

    const last = buildPager({ ...EMPTY_QUEUE_STATE, page: 3 }, QUEUE_PAGE_SIZE * 3);
    expect(last.nextHref).toBeNull();

    // A page beyond the end clamps back to the last real page.
    const beyond = buildPager({ ...EMPTY_QUEUE_STATE, page: 99 }, QUEUE_PAGE_SIZE * 2);
    expect(beyond.page).toBe(2);
    expect(beyond.nextHref).toBeNull();
  });
});

// ── Bucket refinement (Operations Center) ───────────────────────────────────

import {
  pinnedFilterKeys,
  clearPinnedFilters,
  bucketQueueParams,
} from "../queueControls";
import { OPS_BUCKETS } from "../workQueues";

describe("bucket URLs — the toolbar stays inside the bucket", () => {
  const s: QueueState = { ...EMPTY_QUEUE_STATE, q: "azure", severity: "High", page: 3 };

  it("with extra.bucket the URL carries bucket=<id> and NOT queue=all", () => {
    const href = queueHref(s, { bucket: "needs_decision" });
    expect(href).toContain("bucket=needs_decision");
    expect(href).not.toContain("queue=all");
    // The user's refinement rides along.
    expect(href).toContain("q=azure");
    expect(href).toContain("severity=High");
    expect(href).toContain("page=3");
  });

  it("without a bucket the browse queue keeps its queue=all contract", () => {
    expect(queueHref(s)).toContain("queue=all");
  });

  it("Clear all in a bucket clears user filters but PRESERVES the bucket", () => {
    const href = queueHref(clearAllFilters(s), { bucket: "sla_breached" });
    expect(href).toContain("bucket=sla_breached");
    expect(href).not.toContain("q=");
    expect(href).not.toContain("severity=");
  });

  it("the pager carries the bucket on both directions", () => {
    const pager = buildPager({ ...EMPTY_QUEUE_STATE, page: 2 }, 60, { bucket: "ai_risk" });
    expect(pager.prevHref).toContain("bucket=ai_risk");
    expect(pager.nextHref).toContain("bucket=ai_risk");
    expect(pager.nextHref).toContain("page=3");
  });
});

describe("pinnedFilterKeys — a bucket's own axis is never a user control", () => {
  it("maps each implicit param to the toolbar axis it pins", () => {
    expect(pinnedFilterKeys({ decision_state: "needs_review", active: true })).toEqual(
      new Set(["governance"])
    );
    expect(pinnedFilterKeys({ ready_for_decision: true })).toEqual(
      new Set(["governance", "operational"])
    );
    expect(pinnedFilterKeys({ domain: "Regulatory", active: true })).toEqual(new Set(["domain"]));
    expect(pinnedFilterKeys({ overdue: true })).toEqual(new Set(["due"]));
    expect(pinnedFilterKeys({ owner: "me", active: true })).toEqual(new Set(["assignedToMe"]));
    expect(pinnedFilterKeys({ unassigned: true })).toEqual(new Set(["assignedToMe"]));
    // active alone pins nothing — operational refinement composes with it.
    expect(pinnedFilterKeys({ exploited: true, active: true })).toEqual(new Set());
  });

  it("clearPinnedFilters drops stale URL params on pinned axes only", () => {
    const s: QueueState = {
      ...EMPTY_QUEUE_STATE,
      q: "azure",
      governance: "mitigating",
      domain: "Regulatory",
      assignedToMe: true,
    };
    const cleaned = clearPinnedFilters(s, new Set(["governance", "assignedToMe"]));
    expect(cleaned.governance).toBe("");
    expect(cleaned.assignedToMe).toBe(false);
    // Unpinned axes survive.
    expect(cleaned.q).toBe("azure");
    expect(cleaned.domain).toBe("Regulatory");
  });
});

describe("bucketQueueParams — membership is enforced no matter what the URL says", () => {
  it("spreads the bucket's implicit params LAST, over any user value", () => {
    const hostile: QueueState = {
      ...EMPTY_QUEUE_STATE,
      // A hand-edited URL trying to widen the Needs Decision bucket to a
      // different governance population.
      governance: "resolved",
      severity: "High",
      page: 2,
    };
    const params = bucketQueueParams(hostile, { decision_state: "needs_review", active: true });
    expect(params.decision_state).toBe("needs_review"); // bucket wins
    expect(params.active).toBe(true);
    // The legitimate refinement and paging survive.
    expect(params.severity).toBe("High");
    expect(params.offset).toBe(QUEUE_PAGE_SIZE);
    expect(params.limit).toBe(QUEUE_PAGE_SIZE);
  });

  it("carries search/sort/filters into every findings-backed bucket definition", () => {
    const s: QueueState = { ...EMPTY_QUEUE_STATE, q: "CVE-2026", sort: "due_date" };
    for (const b of OPS_BUCKETS) {
      if (b.target.kind !== "findings") continue;
      const params = bucketQueueParams(s, b.target.params);
      expect(params.q).toBe("CVE-2026");
      expect(params.sort).toBe("due_date");
      // Every implicit key of the bucket survives the merge verbatim.
      for (const [k, v] of Object.entries(b.target.params)) {
        expect((params as Record<string, unknown>)[k]).toEqual(v);
      }
    }
  });
});
