/**
 * decisionQueue.test.ts — pure decision-queue logic (ERIP launch-readiness,
 * PR-A). Covers the attention tiles (independent counts) and the exclusive
 * most-urgent-first grouping, without a DOM/RTL harness (the app has none).
 */

import { describe, it, expect } from "vitest";
import {
  isOverdue,
  isUnassigned,
  isCriticalOpen,
  urgencyBucket,
  attentionSummary,
  groupByUrgency,
  isFirstTimeEmpty,
  URGENCY_ORDER,
} from "../decisionQueue";
import type { Finding } from "@/lib/api";

const NOW = Date.parse("2026-07-09T00:00:00.000Z");
const past = "2026-07-01T00:00:00.000Z";
const future = "2026-08-01T00:00:00.000Z";

function f(partial: Partial<Finding>): Finding {
  return {
    id: "f", organization_id: "o", assessment_id: null, source_type: "manual", source_id: null,
    title: "t", severity: "Low", description: "", recommendation: null, framework_control_id: null,
    domain: null, priority: null, likelihood: null, confidence: null, time_sensitivity: null,
    scoring_rationale: null, status: "open", owner_user_id: "u1", due_date: null, action_count: 0,
    created_at: past, updated_at: past, ...partial,
  };
}

describe("attention predicates", () => {
  it("isOverdue: open + past due only", () => {
    expect(isOverdue(f({ due_date: past }), NOW)).toBe(true);
    expect(isOverdue(f({ due_date: future }), NOW)).toBe(false);
    expect(isOverdue(f({ due_date: past, status: "closed" }), NOW)).toBe(false);
    expect(isOverdue(f({ due_date: null }), NOW)).toBe(false);
  });

  it("isUnassigned: open + no owner", () => {
    expect(isUnassigned(f({ owner_user_id: null }))).toBe(true);
    expect(isUnassigned(f({ owner_user_id: "u1" }))).toBe(false);
    expect(isUnassigned(f({ owner_user_id: null, status: "closed" }))).toBe(false);
  });

  it("isCriticalOpen: open + High/Critical", () => {
    expect(isCriticalOpen(f({ severity: "Critical" }))).toBe(true);
    expect(isCriticalOpen(f({ severity: "High" }))).toBe(true);
    expect(isCriticalOpen(f({ severity: "Low" }))).toBe(false);
    expect(isCriticalOpen(f({ severity: "Critical", status: "closed" }))).toBe(false);
  });
});

describe("urgencyBucket — exactly one, most urgent first", () => {
  it("prefers overdue over unassigned/critical", () => {
    expect(urgencyBucket(f({ due_date: past, owner_user_id: null, severity: "Critical" }), NOW)).toBe("overdue");
  });
  it("unassigned before critical", () => {
    expect(urgencyBucket(f({ owner_user_id: null, severity: "Critical" }), NOW)).toBe("unassigned");
  });
  it("critical_open when owned + not overdue", () => {
    expect(urgencyBucket(f({ severity: "High", owner_user_id: "u1" }), NOW)).toBe("critical_open");
  });
  it("in_progress and open and resolved", () => {
    expect(urgencyBucket(f({ status: "in_progress", severity: "Low", owner_user_id: "u1" }), NOW)).toBe("in_progress");
    expect(urgencyBucket(f({ status: "open", severity: "Low", owner_user_id: "u1" }), NOW)).toBe("open");
    expect(urgencyBucket(f({ status: "closed" }), NOW)).toBe("resolved");
  });
});

describe("attentionSummary — independent overlapping counts", () => {
  it("counts a finding in every category it matches", () => {
    const s = attentionSummary([f({ due_date: past, owner_user_id: null, severity: "Critical" })], NOW);
    expect(s).toEqual({ overdue: 1, unassigned: 1, criticalOpen: 1, openTotal: 1 });
  });
  it("excludes closed findings from open counts", () => {
    const s = attentionSummary([f({ due_date: past, owner_user_id: null, severity: "Critical", status: "closed" })], NOW);
    expect(s).toEqual({ overdue: 0, unassigned: 0, criticalOpen: 0, openTotal: 0 });
  });
});

describe("groupByUrgency — exclusive, ordered, non-empty", () => {
  it("orders buckets most-urgent-first and drops empties", () => {
    const groups = groupByUrgency(
      [
        f({ id: "a", status: "open", severity: "Low", owner_user_id: "u1" }),          // open
        f({ id: "b", due_date: past, owner_user_id: null, severity: "Critical" }),      // overdue
        f({ id: "c", owner_user_id: null, severity: "Low" }),                           // unassigned
      ],
      NOW,
    );
    expect(groups.map((g) => g.bucket)).toEqual(["overdue", "unassigned", "open"]);
    // every finding appears exactly once
    expect(groups.flatMap((g) => g.findings.map((x) => x.id)).sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps URGENCY_ORDER as the canonical ordering", () => {
    expect(URGENCY_ORDER[0]).toBe("overdue");
    expect(URGENCY_ORDER[URGENCY_ORDER.length - 1]).toBe("resolved");
  });
});

describe("isFirstTimeEmpty (Day-0 orientation vs filtered-empty)", () => {
  it("is true only when there are no findings AND no active filter", () => {
    expect(isFirstTimeEmpty(0, false, false)).toBe(true);
  });
  it("is false when a filter is active (that is filtered-empty, not first-time)", () => {
    expect(isFirstTimeEmpty(0, true, false)).toBe(false);
    expect(isFirstTimeEmpty(0, false, true)).toBe(false);
  });
  it("is false when findings exist", () => {
    expect(isFirstTimeEmpty(3, false, false)).toBe(false);
  });
});
