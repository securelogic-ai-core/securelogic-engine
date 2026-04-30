import { describe, it, expect } from "vitest";
import {
  enrichBriefSynthesis,
  repairTruncatedJson,
  type BriefSynthesis
} from "../lib/briefSynthesizer.js";
import type { BriefItem } from "../lib/intelligenceBriefGenerator.js";

const sampleItem: BriefItem = {
  cyber_signal_id: "sig-1",
  category: "vulnerability",
  relevance: "high",
  title: "ABB PCM600",
  summary: "Successful exploitation could allow remote code execution.",
  affected_cve: "CVE-2018-1002208",
  affected_vendor: "ABB",
  source_slug: "regulatory_cisa",
  signal_type: "advisory",
  severity: "Critical",
  ingestion_timestamp: "2026-04-30T16:04:42.703Z",
  sort_order: 0,
  analysis: null,
  why_it_matters: "Direct OT exposure in industrial environments.",
  recommended_actions: "1. Patch.",
  analyst_notes: null
};

describe("enrichBriefSynthesis", () => {
  it("throws on empty items[]", async () => {
    await expect(
      enrichBriefSynthesis([], "2026-04-15T00:00:00Z", "2026-04-30T23:59:59Z", [])
    ).rejects.toThrow(/non-empty/);
  });

  it("returns the BriefSynthesis shape with all-null fields when ANTHROPIC_API_KEY is unset", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const result: BriefSynthesis = await enrichBriefSynthesis(
        [sampleItem],
        "2026-04-15T00:00:00Z",
        "2026-04-30T23:59:59Z",
        ["vulnerability"]
      );
      expect(result).toMatchObject({
        thesis: null,
        executive_summary: null,
        cross_domain_analysis: null,
        action_summary: null
      });
      expect(Object.keys(result).sort()).toEqual([
        "action_summary",
        "cross_domain_analysis",
        "executive_summary",
        "thesis"
      ]);
    } finally {
      if (original !== undefined) {
        process.env.ANTHROPIC_API_KEY = original;
      }
    }
  });
});

describe("repairTruncatedJson", () => {
  it("strips a trailing partial-string token at the start of a list and closes structure", () => {
    // Realistic Claude truncation: max_tokens cut mid-string in the first item
    const input = '{"thisWeek":["par';
    const repaired = repairTruncatedJson(input);
    const parsed = JSON.parse(repaired);
    expect(parsed.thisWeek).toEqual([]);
  });

  it("preserves already-completed array entries when truncation happens mid-string later", () => {
    const input = '{"thisWeek":["A","B","par';
    const repaired = repairTruncatedJson(input);
    const parsed = JSON.parse(repaired);
    expect(parsed.thisWeek).toEqual(["A", "B"]);
  });

  it("leaves fully-closed JSON parseable and unchanged", () => {
    const input = '{"thisWeek":["A","B"]}';
    const repaired = repairTruncatedJson(input);
    expect(repaired).toBe(input);
    expect(JSON.parse(repaired)).toEqual({ thisWeek: ["A", "B"] });
  });

  it("repairs a multi-list action_summary fixture truncated mid-string in the second list", () => {
    const truncated =
      '{"thisWeek":["Security team: patch CVE-2026-1"],"thisMonth":["Procurement: contact ven';
    const repaired = repairTruncatedJson(truncated);
    const parsed = JSON.parse(repaired);
    expect(parsed.thisWeek).toEqual(["Security team: patch CVE-2026-1"]);
    expect(parsed.thisMonth).toEqual([]);
  });
});
