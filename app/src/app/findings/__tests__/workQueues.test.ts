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
  it("findings buckets map to engine-side list params", () => {
    expect(bucketListParams(opsBucket("sla_breached")!)).toEqual({ overdue: true, limit: 100 });
    expect(bucketListParams(opsBucket("needs_assignment")!)).toEqual({ unassigned: true, limit: 100 });
    expect(bucketListParams(opsBucket("active_exploitation")!)).toEqual({ exploited: true, limit: 100 });
    expect(bucketListParams(opsBucket("regulatory")!)).toEqual({ domain: "Regulatory", limit: 100 });
    expect(bucketListParams(opsBucket("ai_risk")!)).toEqual({ domain: "AI Governance", limit: 100 });
    expect(bucketListParams(opsBucket("third_party")!)).toEqual({ domain: "Vendor Risk", limit: 100 });
    expect(bucketListParams(opsBucket("needs_decision")!)).toEqual({
      decision_state: "needs_review",
      status: "open",
      limit: 100,
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
    const { counts, unknown } = opsCounts(SUMMARY, 13);
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
