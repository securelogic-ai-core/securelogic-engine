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
  FINDING_CLOSED_STATUS,
  ACTION_ACTIVE_STATUSES,
  ACTION_TERMINAL_STATUSES,
  isFindingActive,
  isFindingActiveLegacyStatus,
  isActionActive,
  sqlFindingActive,
  sqlFindingActiveLegacyStatus,
  sqlActionActive,
  sqlFindingOverdue,
  sqlActionOverdue,
} from "../lib/metricDefinitions.js";
import { OPERATIONAL_STATUSES } from "../lib/findingLifecycleMachine.js";

describe("canonical status sets", () => {
  it("finding ACTIVE = operational_status <> 'closed' (product ruling 2026-07-12)", () => {
    expect(FINDING_CLOSED_STATUS).toBe("closed");
    expect(isFindingActive("open")).toBe(true);
    expect(isFindingActive("in_progress")).toBe(true);
    // The load-bearing one: remediation done, NOT yet validated → still Active.
    expect(isFindingActive("remediated")).toBe(true);
    expect(isFindingActive("closed")).toBe(false);
  });

  it("every operational state except 'closed' is Active — a new state is Active by default", () => {
    // The negative predicate fails SAFE: add a lifecycle state tomorrow and it is
    // Active until someone deliberately rules it closure. An IN-list of active
    // states would instead drop it silently from every count in the product.
    for (const s of OPERATIONAL_STATUSES) {
      expect(isFindingActive(s)).toBe(s !== "closed");
    }
    expect(OPERATIONAL_STATUSES).toContain("closed");
  });

  it("an unknown/absent operational status is ACTIVE — a resolver failure never retires a finding", () => {
    expect(isFindingActive(null)).toBe(true);
    expect(isFindingActive(undefined)).toBe(true);
  });

  it("the LEGACY status predicate is retained for the compat axis only", () => {
    expect([...FINDING_ACTIVE_STATUSES]).toEqual(["open", "in_progress"]);
    expect(isFindingActiveLegacyStatus("open")).toBe(true);
    expect(isFindingActiveLegacyStatus("closed")).toBe(false);
    // 'accepted' was NOT active on the legacy axis; the 20260906 backfill maps it
    // to operational 'closed' precisely to preserve that population.
    expect(isFindingActiveLegacyStatus("accepted")).toBe(false);
    expect(isFindingActiveLegacyStatus(null)).toBe(false);
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
    // The finding predicate now defaults to the OPERATIONAL axis, not `status`.
    expect(sqlFindingActive()).toBe("operational_status <> 'closed'");
    expect(sqlActionActive()).toBe("status IN ('open', 'in_progress', 'blocked')");
    expect(sqlFindingActiveLegacyStatus()).toBe("status IN ('open', 'in_progress')");
  });

  it("the finding ACTIVE fragment never reads the legacy `status` column", () => {
    // The regression guard for the whole reader migration: if someone points the
    // canonical predicate back at `status`, remediated findings quietly drop out
    // of every count (status has no spelling for 'remediated').
    expect(sqlFindingActive()).not.toContain("status IN");
    expect(sqlFindingActive("f.operational_status")).not.toContain("f.status IN");
  });

  it("supports table-aliased columns", () => {
    expect(sqlFindingActive("f.operational_status")).toBe("f.operational_status <> 'closed'");
    expect(sqlActionActive("a.status")).toBe("a.status IN ('open', 'in_progress', 'blocked')");
  });

  it("overdue = active AND date strictly before CURRENT_DATE (never NOW())", () => {
    expect(sqlActionOverdue()).toBe(
      "status IN ('open', 'in_progress', 'blocked') AND due_date IS NOT NULL AND due_date < CURRENT_DATE"
    );
    expect(sqlFindingOverdue("f.operational_status", "f.due_date")).toBe(
      "f.operational_status <> 'closed' AND f.due_date IS NOT NULL AND f.due_date < CURRENT_DATE"
    );
    expect(sqlActionOverdue()).not.toContain("NOW()");
    expect(sqlFindingOverdue()).not.toContain("NOW()");
  });
});
