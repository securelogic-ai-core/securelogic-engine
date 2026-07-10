/**
 * metricDefinitions.test.ts — the Metric Contract's single source of truth.
 *
 * These tests pin the CANONICAL definitions. If one of these fails, an
 * aggregate somewhere is about to diverge from its destination page — fix the
 * caller, not the definition.
 */

import { describe, it, expect } from "vitest";

import {
  FINDING_ACTIVE_STATUSES,
  ACTION_ACTIVE_STATUSES,
  ACTION_TERMINAL_STATUSES,
  isFindingActive,
  isActionActive,
  sqlFindingActive,
  sqlActionActive,
  sqlFindingOverdue,
  sqlActionOverdue,
} from "../lib/metricDefinitions.js";

describe("canonical status sets", () => {
  it("finding ACTIVE = open | in_progress (one definition)", () => {
    expect([...FINDING_ACTIVE_STATUSES]).toEqual(["open", "in_progress"]);
    expect(isFindingActive("open")).toBe(true);
    expect(isFindingActive("in_progress")).toBe(true);
    expect(isFindingActive("closed")).toBe(false);
    expect(isFindingActive("accepted")).toBe(false);
    expect(isFindingActive(null)).toBe(false);
  });

  it("action ACTIVE includes blocked — blocked work is still work", () => {
    expect([...ACTION_ACTIVE_STATUSES]).toEqual(["open", "in_progress", "blocked"]);
    expect(isActionActive("blocked")).toBe(true);
    expect(isActionActive("closed")).toBe(false);
  });

  it("action sets partition: every status is active xor terminal", () => {
    const all = [...ACTION_ACTIVE_STATUSES, ...ACTION_TERMINAL_STATUSES];
    expect(new Set(all).size).toBe(all.length); // disjoint
    expect(all.sort()).toEqual(["accepted", "blocked", "closed", "in_progress", "open"]);
  });
});

describe("SQL fragments", () => {
  it("active fragments quote the exact canonical sets", () => {
    expect(sqlFindingActive()).toBe("status IN ('open', 'in_progress')");
    expect(sqlActionActive()).toBe("status IN ('open', 'in_progress', 'blocked')");
  });

  it("supports table-aliased columns", () => {
    expect(sqlFindingActive("f.status")).toBe("f.status IN ('open', 'in_progress')");
    expect(sqlActionActive("a.status")).toBe("a.status IN ('open', 'in_progress', 'blocked')");
  });

  it("overdue = active AND date strictly before CURRENT_DATE (never NOW())", () => {
    expect(sqlActionOverdue()).toBe(
      "status IN ('open', 'in_progress', 'blocked') AND due_date IS NOT NULL AND due_date < CURRENT_DATE"
    );
    expect(sqlFindingOverdue("f.status", "f.due_date")).toBe(
      "f.status IN ('open', 'in_progress') AND f.due_date IS NOT NULL AND f.due_date < CURRENT_DATE"
    );
    expect(sqlActionOverdue()).not.toContain("NOW()");
    expect(sqlFindingOverdue()).not.toContain("NOW()");
  });
});
