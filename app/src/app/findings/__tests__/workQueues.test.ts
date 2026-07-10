/**
 * workQueues.test.ts — pure work-first queue logic (ERIP). Queues/buckets are the
 * primary interface; these tests cover membership, param parsing, server-truth
 * counts with honest fallback, and the next-up urgency ordering.
 */

import { describe, it, expect } from "vitest";
import {
  WORK_QUEUES,
  workQueueFromParam,
  inWorkQueue,
  queueMembers,
  queueCounts,
  nextUp,
  openWorkCount,
} from "../workQueues";
import type { Finding, FindingsSummary } from "@/lib/api";

const NOW = Date.parse("2026-07-10T00:00:00.000Z");
const past = "2026-07-01T00:00:00.000Z";

function f(partial: Partial<Finding>): Finding {
  return {
    id: "f", organization_id: "o", assessment_id: null, source_type: "manual", source_id: null,
    title: "t", severity: "Low", description: "", recommendation: null, framework_control_id: null,
    domain: null, priority: null, likelihood: null, confidence: null, time_sensitivity: null,
    scoring_rationale: null, status: "open", decision_state: "needs_review", owner_user_id: "u1",
    due_date: null, action_count: 0, created_at: past, updated_at: past, ...partial,
  };
}

describe("workQueueFromParam", () => {
  it("accepts every defined queue id plus 'all'; rejects unknowns", () => {
    for (const q of WORK_QUEUES) expect(workQueueFromParam(q.id)).toBe(q.id);
    expect(workQueueFromParam("all")).toBe("all");
    expect(workQueueFromParam("nope")).toBeNull();
    expect(workQueueFromParam(undefined)).toBeNull();
  });
});

describe("inWorkQueue membership", () => {
  it("overdue / unassigned / critical_open reuse the decision-queue predicates", () => {
    expect(inWorkQueue(f({ due_date: past }), "overdue", NOW)).toBe(true);
    expect(inWorkQueue(f({ owner_user_id: null }), "unassigned", NOW)).toBe(true);
    expect(inWorkQueue(f({ severity: "Critical" }), "critical_open", NOW)).toBe(true);
    expect(inWorkQueue(f({ severity: "Critical", status: "closed" }), "critical_open", NOW)).toBe(false);
  });
  it("decision buckets read decision_state", () => {
    expect(inWorkQueue(f({ decision_state: "needs_review" }), "needs_review", NOW)).toBe(true);
    expect(inWorkQueue(f({ decision_state: "mitigating" }), "mitigating", NOW)).toBe(true);
    expect(inWorkQueue(f({ decision_state: "accepted_risk", status: "accepted" }), "accepted_risk", NOW)).toBe(true);
    expect(inWorkQueue(f({ decision_state: "mitigating" }), "needs_review", NOW)).toBe(false);
  });
  it("a finding with no decision_state (older payload) defaults into needs_review", () => {
    expect(inWorkQueue(f({ decision_state: undefined }), "needs_review", NOW)).toBe(true);
  });
  it("'all' admits everything", () => {
    expect(inWorkQueue(f({ status: "closed" }), "all", NOW)).toBe(true);
  });
  it("queueMembers filters and preserves order", () => {
    const rows = [f({ id: "a", due_date: past }), f({ id: "b" }), f({ id: "c", due_date: past })];
    expect(queueMembers(rows, "overdue", NOW).map((x) => x.id)).toEqual(["a", "c"]);
  });
});

describe("queueCounts", () => {
  const base: FindingsSummary = {
    open_count: 9, critical_open: 2, high_open: 3, medium_open: 1, low_open: 3, closed_count: 4,
    immediate_priority: 1, vendor_sourced: 2, signal_sourced: 3,
    overdue_open: 4, unassigned_open: 2, needs_review_open: 6, mitigating_open: 1, accepted_risk_total: 5,
  };
  it("uses server-truth counts when present (critical = Critical + High)", () => {
    const c = queueCounts(base, [], NOW);
    expect(c).toEqual({ overdue: 4, unassigned: 2, needs_review: 6, critical_open: 5, mitigating: 1, accepted_risk: 5 });
    expect(openWorkCount(c)).toBe(4 + 2 + 6 + 5 + 1);
  });
  it("falls back to counting the fetched page when a count is absent", () => {
    const c = queueCounts(undefined, [f({ due_date: past }), f({ owner_user_id: null })], NOW);
    expect(c.overdue).toBe(1);
    expect(c.unassigned).toBe(1);
  });
});

describe("nextUp", () => {
  it("orders by urgency bucket (overdue → unassigned → critical …), excludes resolved, caps", () => {
    const rows = [
      f({ id: "open-low" }),
      f({ id: "closed", status: "closed" }),
      f({ id: "crit", severity: "Critical" }),
      f({ id: "unassigned", owner_user_id: null }),
      f({ id: "overdue", due_date: past }),
    ];
    expect(nextUp(rows, NOW, 3).map((x) => x.id)).toEqual(["overdue", "unassigned", "crit"]);
  });
});
