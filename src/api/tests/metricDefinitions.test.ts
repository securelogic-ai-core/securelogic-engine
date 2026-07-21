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
  DECISION_TERMINAL_STATES,
  sqlFindingClosed,
  sqlFindingStrictlyOpen,
  sqlFindingPendingIndependentReview,
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

describe("Active / Closed / Strictly-Open — one definition each, and they compose", () => {
  it("Closed is the exact complement of Active, derived from the same constant", () => {
    // The bug this replaces: `status != 'open'` was used as "closed", which swept
    // every in_progress finding into the closed bucket — work in flight reported to
    // customers as work done. Both fragments now key off FINDING_CLOSED_STATUS, so
    // Active and Closed cannot drift apart: one is literally the negation of the other.
    expect(sqlFindingClosed()).toBe("operational_status = 'closed'");
    expect(sqlFindingActive()).toBe("operational_status <> 'closed'");
    expect(sqlFindingClosed()).toContain(FINDING_CLOSED_STATUS);
    expect(sqlFindingActive()).toContain(FINDING_CLOSED_STATUS);
    // Same column, opposite operator — the complement is structural, not a coincidence.
    expect(sqlFindingClosed().replace("=", "<>")).toBe(sqlFindingActive());
  });

  it("Closed reads the OPERATIONAL axis, never the legacy status column", () => {
    // Substring checks are useless here — "operational_status" ENDS with "status".
    // Assert the column identifier itself instead.
    expect(sqlFindingClosed().split(" ")[0]).toBe("operational_status");
    expect(sqlFindingClosed("f.operational_status")).toBe("f.operational_status = 'closed'");
  });

  it("Strictly Open is a LIFECYCLE filter — a strict subset of Active, not a synonym", () => {
    // Preserved on purpose ("what has nobody started yet?"), but it must never back an
    // enterprise metric: a tile built on it empties itself the moment someone starts
    // work, so the number falls as the organisation gets busier.
    expect(sqlFindingStrictlyOpen()).toBe("status = 'open'");
    // It is NOT the Active predicate, and must never be mistaken for it.
    expect(sqlFindingStrictlyOpen()).not.toBe(sqlFindingActive());
    expect(sqlFindingStrictlyOpen()).not.toContain("operational_status");
    // 'in_progress' is Active but NOT strictly open — the whole gap, in one line.
    expect(FINDING_ACTIVE_STATUSES).toContain("in_progress");
    expect(sqlFindingStrictlyOpen()).not.toContain("in_progress");
  });

  it("supports table-aliased columns", () => {
    expect(sqlFindingStrictlyOpen("f.status")).toBe("f.status = 'open'");
  });
});

describe("Pending Independent Review / ready-for-decision — the single predicate", () => {
  it("terminal decision states = resolved + accepted_risk (closure calls)", () => {
    expect([...DECISION_TERMINAL_STATES]).toEqual(["resolved", "accepted_risk"]);
  });

  it("predicate = remediated AND decision NOT terminal (spec §1.3)", () => {
    expect(sqlFindingPendingIndependentReview()).toBe(
      "operational_status = 'remediated' AND decision_state NOT IN ('resolved', 'accepted_risk')"
    );
  });

  it("is REMEDIATED-scoped, not the general Active population", () => {
    // The whole point: this counts work that is DONE and awaiting a governance call —
    // not everything still open. It must read operational_status = 'remediated', never
    // the <> 'closed' Active predicate.
    expect(sqlFindingPendingIndependentReview()).toContain("operational_status = 'remediated'");
    expect(sqlFindingPendingIndependentReview()).not.toBe(sqlFindingActive());
    // Terminal decisions are EXCLUDED — a resolved/accepted finding is decided, not pending.
    for (const s of DECISION_TERMINAL_STATES) {
      expect(sqlFindingPendingIndependentReview()).toContain(`'${s}'`);
    }
  });

  it("supports table-aliased columns at every call site (never request input)", () => {
    expect(sqlFindingPendingIndependentReview("f.operational_status", "f.decision_state")).toBe(
      "f.operational_status = 'remediated' AND f.decision_state NOT IN ('resolved', 'accepted_risk')"
    );
  });
});
