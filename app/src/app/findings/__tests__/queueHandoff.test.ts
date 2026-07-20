/**
 * queueHandoff.test.ts — the originating-queue handoff contract (R-19).
 *
 * These pin the pure logic the new-tab handoff depends on: every queue names itself
 * ("All Findings" + each ops bucket), the decision link carries `from`+`return` so a
 * new tab works from the URL alone, filtered/paginated queues survive the round-trip,
 * and every UNTRUSTED value (malformed `from`, hostile `return`) fails safe — no
 * banner, no open redirect.
 */
import { describe, it, expect } from "vitest";
import {
  buildDecisionHref,
  queueHandoffLabel,
  safeQueueReturnUrl,
  queueHandoffFallbackHref,
  FINDINGS_QUEUE_CONTEXT,
} from "../queueHandoff";
import { OPS_BUCKETS } from "../workQueues";

describe("queueHandoffLabel — every recognized queue names itself, junk fails safe", () => {
  it("labels the browse queue 'Finding Explorer'", () => {
    expect(queueHandoffLabel(FINDINGS_QUEUE_CONTEXT)).toBe("Finding Explorer");
    // The SLUG is a URL value and must not drift with the display name — an
    // in-flight `?from=findings_queue` link still has to resolve.
    expect(queueHandoffLabel("findings_queue")).toBe("Finding Explorer");
  });

  it("labels each Operations Center bucket with its own label", () => {
    for (const b of OPS_BUCKETS) {
      expect(queueHandoffLabel(b.id)).toBe(b.label);
    }
    // The two named in the requirement, explicitly.
    expect(queueHandoffLabel("needs_decision")).toBe("Needs Governance Decision");
    expect(queueHandoffLabel("ready_to_close")).toBe("Ready to Close");
  });

  it("returns null for missing, empty, unrecognized, or oversized values (no banner)", () => {
    expect(queueHandoffLabel(null)).toBeNull();
    expect(queueHandoffLabel(undefined)).toBeNull();
    expect(queueHandoffLabel("")).toBeNull();
    expect(queueHandoffLabel("not_a_bucket")).toBeNull();
    expect(queueHandoffLabel("<script>alert(1)</script>")).toBeNull();
    expect(queueHandoffLabel("a".repeat(200))).toBeNull();
  });
});

describe("safeQueueReturnUrl — a same-origin findings path only (no open redirect)", () => {
  it("accepts a rooted findings path with search preserved", () => {
    expect(safeQueueReturnUrl("/findings")).toBe("/findings");
    expect(safeQueueReturnUrl("/findings?queue=all")).toBe("/findings?queue=all");
    expect(safeQueueReturnUrl("/findings?bucket=needs_decision&after=x")).toBe(
      "/findings?bucket=needs_decision&after=x",
    );
  });

  it("rejects absolute, protocol-relative, and backslash-tricked URLs", () => {
    expect(safeQueueReturnUrl("https://evil.example/findings")).toBeNull();
    expect(safeQueueReturnUrl("//evil.example")).toBeNull();
    expect(safeQueueReturnUrl("/\\evil.example")).toBeNull();
    expect(safeQueueReturnUrl("javascript:alert(1)")).toBeNull();
    expect(safeQueueReturnUrl("/findings\\..\\dashboard")).toBeNull();
  });

  it("rejects paths off the findings surface (can't be pointed at another route)", () => {
    expect(safeQueueReturnUrl("/dashboard")).toBeNull();
    expect(safeQueueReturnUrl("/vendors/123")).toBeNull();
    expect(safeQueueReturnUrl("/findingsX")).toBeNull(); // not /findings or /findings/
  });

  it("rejects control-char smuggling and absent/oversized input", () => {
    expect(safeQueueReturnUrl("/findings\n?q=x")).toBeNull();
    expect(safeQueueReturnUrl("/findings\t")).toBeNull();
    expect(safeQueueReturnUrl(null)).toBeNull();
    expect(safeQueueReturnUrl("")).toBeNull();
    expect(safeQueueReturnUrl("/findings?" + "a".repeat(600))).toBeNull();
  });
});

describe("queueHandoffFallbackHref — a working back-link even without ?return=", () => {
  it("findings_queue → the browse list; each findings bucket → its own ?bucket= view", () => {
    expect(queueHandoffFallbackHref(FINDINGS_QUEUE_CONTEXT)).toBe("/findings?queue=all");
    expect(queueHandoffFallbackHref("needs_decision")).toBe("/findings?bucket=needs_decision");
    expect(queueHandoffFallbackHref("sla_breached")).toBe("/findings?bucket=sla_breached");
  });

  it("href buckets fall back to the surface that owns the work", () => {
    // awaiting_approval → /approvals, review_links → /queue (target.kind === "href").
    expect(queueHandoffFallbackHref("awaiting_approval")).toBe("/approvals");
    expect(queueHandoffFallbackHref("review_links")).toBe("/queue");
  });

  it("null for an unrecognized context", () => {
    expect(queueHandoffFallbackHref("not_a_bucket")).toBeNull();
    expect(queueHandoffFallbackHref(null)).toBeNull();
  });
});

describe("buildDecisionHref — the link a new tab opens", () => {
  it("no queue context → the bare finding URL (unchanged legacy behavior)", () => {
    expect(buildDecisionHref("f-1", null, "/vendors/v-1")).toBe("/findings/f-1");
    expect(buildDecisionHref("f-1", undefined)).toBe("/findings/f-1");
  });

  it("carries ?from=<context> for All Findings and every bucket", () => {
    expect(buildDecisionHref("f-1", "findings_queue", "/findings")).toContain("from=findings_queue");
    expect(buildDecisionHref("f-1", "needs_decision", "/findings")).toContain("from=needs_decision");
  });

  it("carries an exact ?return= that preserves search, filters, sort, and page", () => {
    const href = buildDecisionHref(
      "f-1",
      "findings_queue",
      "/findings",
      "q=azure&severity=Critical&sort=due_asc&page=3",
    );
    const returned = new URLSearchParams(href.split("?")[1]).get("return");
    expect(returned).toBe("/findings?q=azure&severity=Critical&sort=due_asc&page=3");
  });

  it("preserves a paginated ops-bucket URL (bucket + cursor + trail)", () => {
    const href = buildDecisionHref(
      "f-1",
      "needs_decision",
      "/findings",
      "bucket=needs_decision&after=2026-01-01~abc&trail=t1,t2",
    );
    const returned = new URLSearchParams(href.split("?")[1]).get("return");
    expect(returned).toBe("/findings?bucket=needs_decision&after=2026-01-01~abc&trail=t1,t2");
  });

  it("omits ?return= when the current path is not a safe findings URL", () => {
    // Defense in depth: even if a caller passes an off-surface path, no return is emitted.
    const href = buildDecisionHref("f-1", "findings_queue", "/dashboard", "x=1");
    expect(href).toBe("/findings/f-1?from=findings_queue");
    expect(href).not.toContain("return=");
  });
});
