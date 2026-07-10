/**
 * workQueues.test.ts — pure operations-center bucket logic (ERIP). Buckets are the
 * primary interface; these tests cover the bucket registry, href/server-filter
 * mapping, server-truth counts with honest unknowns, and the due-work rollup.
 */

import { describe, it, expect } from "vitest";
import {
  OPS_BUCKETS,
  OPS_GROUP_LABELS,
  opsBucket,
  bucketsInGroup,
  bucketHref,
  bucketListParams,
  opsCounts,
  dueWorkCount,
  encodeCursor,
  decodeCursor,
  parseTrail,
  bucketPageHrefs,
  pageRange,
  BUCKET_PAGE_SIZE,
  type OpsBucketId,
} from "../workQueues";
import type { FindingsSummary } from "@/lib/api";

const SUMMARY: FindingsSummary = {
  open_count: 40, critical_open: 4, high_open: 6, medium_open: 10, low_open: 20, closed_count: 5,
  immediate_priority: 3, vendor_sourced: 8, signal_sourced: 12,
  overdue_open: 7, unassigned_open: 5, needs_review_open: 9, mitigating_open: 2, accepted_risk_total: 3,
  regulatory_open: 4, ai_governance_open: 6, vendor_risk_open: 11, exploited_open: 2,
  pending_risk_approvals: 1,
};

describe("bucket registry", () => {
  it("covers the operations-center buckets across the three groups", () => {
    const ids = OPS_BUCKETS.map((b) => b.id);
    for (const required of [
      "needs_assignment", "sla_breached", "needs_decision", "awaiting_approval", "review_links",
      "active_exploitation", "regulatory", "ai_risk", "third_party",
    ] as OpsBucketId[]) {
      expect(ids).toContain(required);
    }
    expect(Object.keys(OPS_GROUP_LABELS).sort()).toEqual(["decisions", "domains", "tracking"]);
    // every bucket belongs to a labeled group and groups partition the registry
    const grouped = (["decisions", "domains", "tracking"] as const).flatMap((g) => bucketsInGroup(g));
    expect(grouped.length).toBe(OPS_BUCKETS.length);
  });

  it("opsBucket parses ids and rejects unknowns", () => {
    expect(opsBucket("sla_breached")?.label).toBe("SLA Breached");
    expect(opsBucket("nope")).toBeNull();
    expect(opsBucket(undefined)).toBeNull();
  });
});

describe("bucket targets — server-side filters, never client filtering", () => {
  it("findings buckets map to engine-side list params (stable sort + paged)", () => {
    const P = { sort: "created", limit: BUCKET_PAGE_SIZE };
    expect(bucketListParams(opsBucket("sla_breached")!)).toEqual({ overdue: true, ...P });
    expect(bucketListParams(opsBucket("needs_assignment")!)).toEqual({ unassigned: true, ...P });
    expect(bucketListParams(opsBucket("active_exploitation")!)).toEqual({ exploited: true, active: true, ...P });
    expect(bucketListParams(opsBucket("regulatory")!)).toEqual({ domain: "Regulatory", active: true, ...P });
    expect(bucketListParams(opsBucket("ai_risk")!)).toEqual({ domain: "AI Governance", active: true, ...P });
    expect(bucketListParams(opsBucket("third_party")!)).toEqual({ domain: "Vendor Risk", active: true, ...P });
    expect(bucketListParams(opsBucket("needs_decision")!)).toEqual({
      decision_state: "needs_review",
      active: true,
      ...P,
    });
  });

  it("a cursor is threaded into the bucket page params", () => {
    const cur = { created_at: "2026-07-01T00:00:00.000Z", id: "11111111-1111-1111-1111-111111111111" };
    expect(bucketListParams(opsBucket("sla_breached")!, cur)).toEqual({
      overdue: true,
      sort: "created",
      before: cur,
      limit: BUCKET_PAGE_SIZE,
    });
  });

  it("cross-surface work opens the surface that owns it", () => {
    expect(bucketHref(opsBucket("awaiting_approval")!)).toBe("/approvals");
    expect(bucketHref(opsBucket("review_links")!)).toBe("/queue");
    expect(bucketListParams(opsBucket("awaiting_approval")!)).toBeNull();
  });

  it("findings buckets open the subordinate view URL", () => {
    expect(bucketHref(opsBucket("sla_breached")!)).toBe("/findings?bucket=sla_breached");
  });
});

describe("opsCounts — server truth with honest unknowns", () => {
  it("maps every bucket to its summary/suggestions count", () => {
    const { counts, unknown } = opsCounts({ ...SUMMARY, my_work_open: 4 }, 13);
    expect(counts.my_work).toBe(4);
    expect(counts.sla_breached).toBe(7);
    expect(counts.needs_assignment).toBe(5);
    expect(counts.needs_decision).toBe(9);
    expect(counts.awaiting_approval).toBe(1);
    expect(counts.review_links).toBe(13);
    expect(counts.active_exploitation).toBe(2);
    expect(counts.regulatory).toBe(4);
    expect(counts.ai_risk).toBe(6);
    expect(counts.third_party).toBe(11);
    expect(counts.in_mitigation).toBe(2);
    expect(counts.accepted_risk).toBe(3);
    expect(unknown).toEqual([]);
  });

  it("reports missing counts as UNKNOWN instead of a lying zero", () => {
    const { counts, unknown } = opsCounts(undefined, null);
    expect(counts.sla_breached).toBe(0);
    expect(unknown).toContain("sla_breached");
    expect(unknown).toContain("review_links");
  });
});

describe("dueWorkCount", () => {
  it("sums only urgent buckets (tracking buckets never count as due work)", () => {
    const { counts } = opsCounts(SUMMARY, 13);
    // urgent: sla 7 + assignment 5 + decision 9 + approval 1 + links 13 + exploitation 2 = 37
    expect(dueWorkCount(counts)).toBe(37);
  });
});

describe("My Work bucket", () => {
  it("is a first-class decisions bucket using owner=me + active (never a raw user id)", () => {
    const b = opsBucket("my_work")!;
    expect(b.group).toBe("decisions");
    expect(b.urgent).toBe(true);
    expect(bucketListParams(b)).toEqual({ owner: "me", active: true, sort: "created", limit: BUCKET_PAGE_SIZE });
    expect(bucketHref(b)).toBe("/findings?bucket=my_work");
  });
  it("counts from the session-scoped my_work_open; absent (API-key caller) → honest unknown", () => {
    const withMine = opsCounts({ ...SUMMARY, my_work_open: 4 }, 13);
    expect(withMine.counts.my_work).toBe(4);
    expect(withMine.unknown).not.toContain("my_work");
    const withoutMine = opsCounts(SUMMARY, 13);
    expect(withoutMine.unknown).toContain("my_work");
  });
});

describe("keyset pagination helpers", () => {
  const CUR = { created_at: "2026-07-01T00:00:00.000Z", id: "11111111-1111-1111-1111-111111111111" };
  const TOK = encodeCursor(CUR);

  it("encode/decode round-trips; every invalid input fails safe to null (first page)", () => {
    expect(decodeCursor(TOK)).toEqual(CUR);
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("no-separator")).toBeNull();
    expect(decodeCursor("not-a-date~11111111-1111-1111-1111-111111111111")).toBeNull();
    expect(decodeCursor("2026-07-01T00:00:00.000Z~not-a-uuid")).toBeNull();
    expect(decodeCursor("x".repeat(200))).toBeNull();
  });

  it("parseTrail drops invalid tokens and bounds the trail", () => {
    expect(parseTrail(`${TOK},garbage,${TOK}`)).toEqual([TOK, TOK]);
    expect(parseTrail(undefined)).toEqual([]);
    expect(parseTrail(Array(100).fill(TOK).join(",")).length).toBe(50);
  });

  it("first page: no prev; next pushes the cursor and preserves the bucket", () => {
    const { nextHref, prevHref } = bucketPageHrefs("sla_breached", null, [], CUR);
    expect(prevHref).toBeNull();
    expect(nextHref).toBe(`/findings?bucket=sla_breached&after=${encodeURIComponent(TOK)}`);
  });

  it("deep page: next carries the trail; prev pops back to the prior cursor", () => {
    const t1 = encodeCursor({ ...CUR, id: "22222222-2222-2222-2222-222222222222" });
    const { nextHref, prevHref } = bucketPageHrefs("my_work", TOK, [t1], CUR);
    expect(nextHref).toContain("bucket=my_work");
    expect(nextHref).toContain(`trail=${encodeURIComponent(`${t1},${TOK}`)}`);
    expect(prevHref).toBe(`/findings?bucket=my_work&after=${encodeURIComponent(t1)}`);
  });

  it("second page: prev returns to the clean first page; final page has no next", () => {
    const { prevHref, nextHref } = bucketPageHrefs("regulatory", TOK, [], null);
    expect(prevHref).toBe("/findings?bucket=regulatory");
    expect(nextHref).toBeNull();
  });

  it("pageRange: boundaries, empty page, and deep-page math", () => {
    expect(pageRange(null, [], 25)).toEqual({ start: 1, end: 25 });
    expect(pageRange(null, [], 0)).toEqual({ start: 0, end: 0 });
    expect(pageRange(TOK, [], 25)).toEqual({ start: 26, end: 50 });
    expect(pageRange(TOK, [TOK, TOK], 7)).toEqual({ start: 76, end: 82 });
  });
});
