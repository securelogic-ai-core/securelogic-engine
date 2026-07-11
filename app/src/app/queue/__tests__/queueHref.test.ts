/**
 * The B4 guard: a queue link must never silently drop the finding scope.
 *
 * "Review in queue" used to land the user in the org-wide pending queue (4000+
 * rows) with no way back to the two suggestions they were looking at. Scoping the
 * arrival is only half the fix — the scope also has to SURVIVE the first filter
 * chip, sort or page click, or the user is dumped right back into the dump.
 */
import { describe, it, expect } from "vitest";
import {
  buildQueueHref,
  isUuid,
  isQueueStatus,
  normalizeQueueQuery,
} from "../queueHref";

const SIGNAL = "a1b2c3d4-e5f6-4789-abcd-ef1234567890";

describe("buildQueueHref", () => {
  it("the bare queue is just /queue — no default noise in the URL", () => {
    expect(buildQueueHref()).toBe("/queue");
    expect(buildQueueHref({ sort: "created-desc", offset: 0 })).toBe("/queue");
  });

  it("carries the finding scope", () => {
    expect(buildQueueHref({ signalId: SIGNAL })).toBe(`/queue?signal_id=${SIGNAL}`);
  });

  it("KEEPS the scope when a target-type chip is applied", () => {
    // The exact regression B4 was: filter, and the scope quietly vanishes.
    const href = buildQueueHref({ signalId: SIGNAL, targetType: "vendor" });
    expect(href).toContain(`signal_id=${SIGNAL}`);
    expect(href).toContain("target_type=vendor");
  });

  it("KEEPS the scope across sort and pagination", () => {
    const href = buildQueueHref({ signalId: SIGNAL, sort: "score-desc", offset: 50 });
    expect(href).toContain(`signal_id=${SIGNAL}`);
    expect(href).toContain("sort=score-desc");
    expect(href).toContain("offset=50");
  });

  it("keeps the scope even on the 'All types' chip (target_type cleared, scope kept)", () => {
    expect(buildQueueHref({ signalId: SIGNAL, offset: 0 })).toBe(`/queue?signal_id=${SIGNAL}`);
  });

  it("an unscoped queue stays unscoped", () => {
    expect(buildQueueHref({ targetType: "control" })).toBe("/queue?target_type=control");
  });
});

describe("R3 — search and review-state survive every other control", () => {
  it("keeps the search when a target-type chip is applied", () => {
    const href = buildQueueHref({ q: "Microsoft", targetType: "vendor" });
    expect(href).toContain("q=Microsoft");
    expect(href).toContain("target_type=vendor");
  });

  it("keeps the search AND the finding scope together", () => {
    // The compound case: arrive scoped from a finding, then search within it.
    const href = buildQueueHref({ signalId: SIGNAL, q: "Microsoft", status: "dismissed" });
    expect(href).toContain(`signal_id=${SIGNAL}`);
    expect(href).toContain("q=Microsoft");
    expect(href).toContain("status=dismissed");
  });

  it("omits status when it is the default — the common URL stays clean", () => {
    expect(buildQueueHref({ status: "pending" })).toBe("/queue");
    expect(buildQueueHref({ status: "accepted" })).toBe("/queue?status=accepted");
  });

  it("trims the query and drops it when empty", () => {
    expect(buildQueueHref({ q: "   " })).toBe("/queue");
    expect(buildQueueHref({ q: "  Cisco  " })).toBe("/queue?q=Cisco");
  });
});

describe("normalizeQueueQuery — a bad search loses the filter, not the page", () => {
  it("accepts a real query", () => {
    expect(normalizeQueueQuery("Microsoft")).toBe("Microsoft");
    expect(normalizeQueueQuery("  Cisco  ")).toBe("Cisco");
  });

  it("rejects what the engine would 400 on, degrading to no filter", () => {
    // The engine bounds q at 2..120. A one-character search must not error the page.
    expect(normalizeQueueQuery("M")).toBeUndefined();
    expect(normalizeQueueQuery("")).toBeUndefined();
    expect(normalizeQueueQuery(undefined)).toBeUndefined();
    expect(normalizeQueueQuery("x".repeat(121))).toBeUndefined();
  });
});

describe("isQueueStatus", () => {
  it("accepts the three real review states", () => {
    for (const s of ["pending", "accepted", "dismissed"]) expect(isQueueStatus(s)).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isQueueStatus("all")).toBe(false);
    expect(isQueueStatus(undefined)).toBe(false);
  });
});

describe("isUuid — a bad deep link loses the scope, not the page", () => {
  it("accepts a real uuid", () => {
    expect(isUuid(SIGNAL)).toBe(true);
  });

  it("rejects junk the engine would 400 on", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    // SQL-ish junk must never reach the engine as a filter value.
    expect(isUuid("' OR 1=1--")).toBe(false);
  });
});
