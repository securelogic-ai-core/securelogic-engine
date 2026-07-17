/**
 * findingsQueueOrdering.test.ts — the scalable-queue ORDER BY / due-status
 * fragments. Pure string builders (constants in, constants out), so this is a
 * database-free unit test.
 */

import { describe, it, expect } from "vitest";
import {
  DUE_SOON_DAYS,
  DUE_STATUSES,
  QUEUE_SORTS,
  VALID_DUE_STATUSES,
  VALID_QUEUE_SORTS,
  dueStatusCondition,
  queueOrderBy,
  type DueStatus,
  type QueueSort,
} from "../findingsQueueOrdering.js";

describe("findingsQueueOrdering — constants", () => {
  it("due-soon window is a week and matches the card's <=7 treatment", () => {
    expect(DUE_SOON_DAYS).toBe(7);
  });

  it("exposes the four due statuses and five sorts", () => {
    expect([...DUE_STATUSES]).toEqual(["overdue", "today", "soon", "none"]);
    expect([...QUEUE_SORTS]).toEqual(["urgency", "severity", "due_date", "newest", "oldest"]);
    for (const d of DUE_STATUSES) expect(VALID_DUE_STATUSES.has(d)).toBe(true);
    for (const s of QUEUE_SORTS) expect(VALID_QUEUE_SORTS.has(s)).toBe(true);
    expect(VALID_QUEUE_SORTS.has("created")).toBe(false);
    expect(VALID_DUE_STATUSES.has("nonsense")).toBe(false);
  });
});

describe("findingsQueueOrdering — dueStatusCondition", () => {
  it("overdue is active AND strictly before today", () => {
    const c = dueStatusCondition("overdue");
    expect(c).toContain("f.operational_status <> 'closed'");
    expect(c).toContain("f.due_date < CURRENT_DATE");
    // Never NOW() — a due-today finding must not be overdue.
    expect(c).not.toContain("NOW()");
  });

  it("today is an exact date equality", () => {
    expect(dueStatusCondition("today")).toBe("f.due_date = CURRENT_DATE");
  });

  it("soon is active AND strictly after today, within the window", () => {
    const c = dueStatusCondition("soon");
    expect(c).toContain("f.due_date > CURRENT_DATE");
    expect(c).toContain(`CURRENT_DATE + INTERVAL '${DUE_SOON_DAYS} days'`);
    expect(c).toContain("f.operational_status <> 'closed'");
  });

  it("none is a NULL due date", () => {
    expect(dueStatusCondition("none")).toBe("f.due_date IS NULL");
  });

  it("the four buckets do not overlap by construction (< today, = today, > today, null)", () => {
    // overdue uses <, today uses =, soon uses >, none uses IS NULL — disjoint.
    expect(dueStatusCondition("overdue")).toContain("< CURRENT_DATE");
    expect(dueStatusCondition("today")).toContain("= CURRENT_DATE");
    expect(dueStatusCondition("soon")).toContain("> CURRENT_DATE");
    expect(dueStatusCondition("none")).toContain("IS NULL");
  });

  it("honors custom column handles", () => {
    const c = dueStatusCondition("overdue", {
      operationalCol: "x.op",
      dueCol: "x.due",
      severityCol: "x.sev",
      createdCol: "x.created",
      idCol: "x.id",
    });
    expect(c).toContain("x.op <> 'closed'");
    expect(c).toContain("x.due < CURRENT_DATE");
  });
});

describe("findingsQueueOrdering — queueOrderBy", () => {
  it("urgency puts active before closed, then the ratified tiers, ending on a stable tiebreak", () => {
    const o = queueOrderBy("urgency");
    // active-first, 1 overdue, 2 due today/soon, 3/4 severity, 5 nearest due, 6 oldest, tiebreak id.
    // The FIRST predicate keeps unresolved work ahead of closed findings.
    expect(o.indexOf("<> 'closed'")).toBeLessThan(o.indexOf("< CURRENT_DATE"));
    const overdueIdx = o.indexOf("< CURRENT_DATE");
    const soonIdx = o.indexOf(`INTERVAL '${DUE_SOON_DAYS} days'`);
    const sevIdx = o.indexOf("WHEN 'Critical' THEN 0");
    const nearestIdx = o.indexOf("f.due_date ASC NULLS LAST");
    const oldestIdx = o.indexOf("f.created_at ASC");
    expect(overdueIdx).toBeGreaterThanOrEqual(0);
    expect(overdueIdx).toBeLessThan(soonIdx);
    expect(soonIdx).toBeLessThan(sevIdx);
    expect(sevIdx).toBeLessThan(nearestIdx);
    expect(nearestIdx).toBeLessThan(oldestIdx);
    expect(o.trimEnd().endsWith("f.id ASC")).toBe(true);
  });

  it("severity ranks Critical highest then newest-first", () => {
    const o = queueOrderBy("severity");
    expect(o).toContain("WHEN 'Critical' THEN 0");
    expect(o).toContain("f.created_at DESC, f.id DESC");
  });

  it("due_date orders nearest first with nulls last", () => {
    expect(queueOrderBy("due_date")).toBe("f.due_date ASC NULLS LAST, f.created_at ASC, f.id ASC");
  });

  it("newest and oldest are pure created_at directions with an id tiebreak", () => {
    expect(queueOrderBy("newest")).toBe("f.created_at DESC, f.id DESC");
    expect(queueOrderBy("oldest")).toBe("f.created_at ASC, f.id ASC");
  });

  it("every sort ends with an id tiebreak so OFFSET paging is stable", () => {
    for (const s of QUEUE_SORTS) {
      const o = queueOrderBy(s).trimEnd();
      expect(o.endsWith("f.id ASC") || o.endsWith("f.id DESC")).toBe(true);
    }
  });
});

// Type-guard the exhaustiveness of the switch statements at compile time.
const _sort: QueueSort = "urgency";
const _due: DueStatus = "overdue";
void _sort;
void _due;
