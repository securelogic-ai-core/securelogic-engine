/**
 * applicabilityViews.test.ts — R5: pure-helper tests for the applicability +
 * evidence views (query builder, decision/target/category labels, short-hash),
 * matching the app's no-network unit-test convention.
 */

import { describe, expect, it } from "vitest";

import {
  applicabilityQuery,
  APPLICABILITY_DECISIONS,
  APPLICABILITY_PAGE,
} from "../enterpriseContext";
import {
  decisionLabel,
  evidenceCategoryLabel,
  matchTargetLabel,
  shortHash,
} from "../enterpriseContextFormat";

describe("applicabilityQuery", () => {
  it("includes only provided filters and always clamps pagination", () => {
    const q = new URLSearchParams(applicabilityQuery({}));
    expect(q.get("decision")).toBeNull();
    expect(q.get("target_type")).toBeNull();
    expect(q.get("signal_id")).toBeNull();
    expect(q.get("limit")).toBe(String(APPLICABILITY_PAGE.defaultLimit));
    expect(q.get("offset")).toBe("0");
  });

  it("passes filters through and clamps an oversized limit", () => {
    const q = new URLSearchParams(
      applicabilityQuery({
        decision: "affected",
        target_type: "vendor",
        signal_id: "sig-1",
        limit: 9999,
        offset: -5,
      }),
    );
    expect(q.get("decision")).toBe("affected");
    expect(q.get("target_type")).toBe("vendor");
    expect(q.get("signal_id")).toBe("sig-1");
    expect(q.get("limit")).toBe(String(APPLICABILITY_PAGE.maxLimit));
    expect(q.get("offset")).toBe("0");
  });
});

describe("decisionLabel", () => {
  it("labels every engine decision", () => {
    const labels = APPLICABILITY_DECISIONS.map(decisionLabel);
    expect(labels).toEqual([
      "Affected",
      "Potentially Affected",
      "Not Affected",
      "Needs Review",
      "Unknown",
    ]);
  });

  it("falls back to title-case for unknown values", () => {
    expect(decisionLabel("some_new_decision")).toBe("Some New Decision");
  });
});

describe("matchTargetLabel", () => {
  it("labels the four applicability target types", () => {
    expect(matchTargetLabel("vendor")).toBe("Vendor");
    expect(matchTargetLabel("ai_system")).toBe("AI System");
    expect(matchTargetLabel("control")).toBe("Control");
    expect(matchTargetLabel("obligation")).toBe("Obligation");
  });
});

describe("shortHash", () => {
  it("truncates long hashes and leaves short values alone", () => {
    expect(shortHash("a".repeat(64))).toBe(`${"a".repeat(12)}…`);
    expect(shortHash("abc")).toBe("abc");
    expect(shortHash("")).toBe("");
  });
});

describe("evidenceCategoryLabel", () => {
  it("humanizes category slugs", () => {
    expect(evidenceCategoryLabel("match")).toBe("Match");
    expect(evidenceCategoryLabel("graph_reachability")).toBe("Graph Reachability");
  });
});
