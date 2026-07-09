/**
 * actionQueue.test.ts — pure remediation-queue logic (ERIP §5 My Actions depth).
 * Covers SLA state, source linkage, ownership, attention tiles (independent
 * counts) and the exclusive most-urgent-first grouping, with no DOM/RTL harness.
 */

import { describe, it, expect } from "vitest";
import {
  slaState,
  isAtRisk,
  actionSourceHref,
  ownershipLabel,
  actionAttention,
  actionBucket,
  groupBySla,
  ACTION_BUCKET_ORDER,
} from "../actionQueue";
import type { Action } from "@/lib/api";

const NOW = Date.parse("2026-07-09T12:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

function action(over: Partial<Action> = {}): Action {
  return {
    id: "a1",
    organization_id: "org",
    title: "Patch gateway",
    description: null,
    action_type: null,
    source_type: "finding",
    source_id: "f1",
    priority: "near_term",
    due_date: null,
    owner_user_id: null,
    status: "open",
    completed_at: null,
    created_at: iso(NOW),
    updated_at: iso(NOW),
    ...over,
  };
}

describe("slaState", () => {
  it("classifies overdue / due-today / due-this-week / scheduled", () => {
    expect(slaState(action({ due_date: iso(NOW - 2 * day) }), NOW)).toBe("overdue");
    expect(slaState(action({ due_date: iso(NOW) }), NOW)).toBe("due_today");
    expect(slaState(action({ due_date: iso(NOW + 3 * day) }), NOW)).toBe("due_this_week");
    expect(slaState(action({ due_date: iso(NOW + 30 * day) }), NOW)).toBe("scheduled");
  });
  it("is 'none' when there is no due date or the action is resolved", () => {
    expect(slaState(action({ due_date: null }), NOW)).toBe("none");
    expect(slaState(action({ due_date: iso(NOW - 5 * day), status: "closed" }), NOW)).toBe("none");
    expect(slaState(action({ due_date: iso(NOW - 5 * day), status: "accepted" }), NOW)).toBe("none");
  });
  it("isAtRisk covers overdue through due-this-week only", () => {
    expect(isAtRisk(action({ due_date: iso(NOW - day) }), NOW)).toBe(true);
    expect(isAtRisk(action({ due_date: iso(NOW + 3 * day) }), NOW)).toBe(true);
    expect(isAtRisk(action({ due_date: iso(NOW + 30 * day) }), NOW)).toBe(false);
  });
});

describe("actionSourceHref (no dead ends)", () => {
  it("links finding / risk / obligation sources to their record", () => {
    expect(actionSourceHref(action({ source_type: "finding", source_id: "f9" }))).toBe("/findings/f9");
    expect(actionSourceHref(action({ source_type: "risk", source_id: "r9" }))).toBe("/risks/r9");
    expect(actionSourceHref(action({ source_type: "obligation", source_id: "o9" }))).toBe("/obligations/o9");
  });
  it("returns null when there is nothing to link to", () => {
    expect(actionSourceHref(action({ source_type: "finding", source_id: null }))).toBeNull();
    expect(actionSourceHref(action({ source_type: "manual", source_id: "m1" }))).toBeNull();
  });
});

describe("ownershipLabel (session-derived, R5)", () => {
  it("labels you / assigned / unassigned", () => {
    expect(ownershipLabel(action({ owner_user_id: "u1" }), "u1")).toBe("you");
    expect(ownershipLabel(action({ owner_user_id: "u2" }), "u1")).toBe("assigned");
    expect(ownershipLabel(action({ owner_user_id: null }), "u1")).toBe("unassigned");
  });
  it("never reads as 'you' without a session identity", () => {
    expect(ownershipLabel(action({ owner_user_id: "u1" }), undefined)).toBe("assigned");
  });
});

describe("actionAttention (independent counts)", () => {
  it("counts open / overdue / at-risk / unassigned, ignoring resolved", () => {
    const actions = [
      action({ id: "1", due_date: iso(NOW - day), owner_user_id: null }), // overdue + unassigned + open + at-risk
      action({ id: "2", due_date: iso(NOW + 2 * day), owner_user_id: "u1" }), // at-risk + open
      action({ id: "3", due_date: iso(NOW + 40 * day), owner_user_id: "u1" }), // open only
      action({ id: "4", status: "closed", due_date: iso(NOW - day) }), // resolved → ignored
    ];
    expect(actionAttention(actions, NOW)).toEqual({ open: 3, overdue: 1, atRisk: 2, unassigned: 1 });
  });
});

describe("groupBySla (exclusive, most-urgent-first)", () => {
  it("orders buckets and drops empty ones; resolved sinks last", () => {
    const actions = [
      action({ id: "r", status: "closed" }),
      action({ id: "o", due_date: iso(NOW - day) }),
      action({ id: "w", due_date: iso(NOW + 2 * day) }),
    ];
    const groups = groupBySla(actions, NOW);
    expect(groups.map((g) => g.bucket)).toEqual(["overdue", "due_this_week", "resolved"]);
  });
  it("every action lands in exactly one bucket", () => {
    const actions = [action({ id: "1" }), action({ id: "2", status: "accepted" })];
    const total = groupBySla(actions, NOW).reduce((n, g) => n + g.actions.length, 0);
    expect(total).toBe(actions.length);
  });
  it("actionBucket resolves done actions regardless of due date", () => {
    expect(actionBucket(action({ status: "closed", due_date: iso(NOW - day) }), NOW)).toBe("resolved");
    expect(ACTION_BUCKET_ORDER[ACTION_BUCKET_ORDER.length - 1]).toBe("resolved");
  });
});
